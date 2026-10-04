export type Choice = "" | "yes" | "no" | "unsure";
export type ImageReview = {
  type: string;
  usable: Choice;
  text: Choice;
  issues: string[];
  rotation: number;
  note: string;
  uncertain: boolean;
  seconds: number;
};
export type Family = {
  id: string;
  name: string;
  members: string[];
  representative: string;
  note: string;
};
export type Families = {
  groups: Family[];
  complete: boolean;
  singletonDeclaration: boolean;
};
export type Query = {
  fr: string;
  en: string;
  criterion: string;
  cluster: string;
  note: string;
  equivalence: "pending" | "equivalent" | "needs_revision";
  bilingualReviewer: string;
  authorDeclaration: boolean;
};
export function initialImage(): ImageReview {
  return {
    type: "",
    usable: "",
    text: "",
    issues: [],
    rotation: 0,
    note: "",
    uncertain: false,
    seconds: 0,
  };
}
const types = ["aerial", "street", "map", "document", "other", "unclear"];
function text(v: unknown, max: number, required = false): string {
  if (typeof v !== "string" || v.length > max || (required && !v.trim()))
    throw Error("Please complete the required fields.");
  return v.trim();
}
function object(v: unknown): Record<string, unknown> {
  if (!v || typeof v !== "object" || Array.isArray(v))
    throw Error("Invalid review.");
  return v as Record<string, unknown>;
}
function bool(v: unknown): boolean {
  if (typeof v !== "boolean") throw Error("Invalid checkbox value.");
  return v;
}
export function validate(
  kind: string,
  key: string,
  input: unknown,
  ids: string[],
): ImageReview | Families | Query {
  const x = object(input);
  if (kind === "image") {
    if (
      !ids.includes(key) ||
      !types.includes(String(x.type)) ||
      !["yes", "no", "unsure"].includes(String(x.usable)) ||
      !["yes", "no", "unsure"].includes(String(x.text))
    )
      throw Error("Choose an image type and answer both questions.");
    if (
      !Array.isArray(x.issues) ||
      new Set(x.issues).size !== x.issues.length ||
      x.issues.some((i) => !["dark", "blurred", "cropped"].includes(i))
    )
      throw Error("Invalid image issues.");
    if (
      ![0, 90, 180, 270].includes(Number(x.rotation)) ||
      typeof x.rotation !== "number" ||
      typeof x.seconds !== "number" ||
      !Number.isFinite(x.seconds) ||
      x.seconds < 0 ||
      x.seconds > 86400
    )
      throw Error("Invalid view rotation or review time.");
    const out = {
      type: String(x.type),
      usable: x.usable as Choice,
      text: x.text as Choice,
      issues: x.issues,
      rotation: x.rotation,
      note: text(x.note, 2000),
      uncertain: bool(x.uncertain),
      seconds: Math.round(x.seconds),
    };
    if ((out.uncertain || out.usable === "unsure") && !out.note)
      throw Error("Add a short note about what is uncertain.");
    return out;
  }
  if (kind === "families") {
    if (
      key !== "corpus" ||
      !Array.isArray(x.groups) ||
      x.groups.length > ids.length
    )
      throw Error("Invalid family review.");
    const seen = new Set<string>(),
      groupIds = new Set<string>();
    const groups = x.groups
      .map((raw) => {
        const g = object(raw);
        const id = text(g.id, 60, true);
        if (groupIds.has(id)) throw Error("Duplicate family ID.");
        groupIds.add(id);
        if (
          !Array.isArray(g.members) ||
          g.members.length < 2 ||
          g.members.length > ids.length
        )
          throw Error("Select at least two related images.");
        const members = g.members
          .map((m) => {
            if (typeof m !== "string" || !ids.includes(m) || seen.has(m))
              throw Error("An image can belong to only one family.");
            seen.add(m);
            return m;
          })
          .sort();
        const representative = text(g.representative, 3, true);
        if (!members.includes(representative))
          throw Error("Choose a representative from this family.");
        return {
          id,
          name: text(g.name, 100, true),
          members,
          representative,
          note: text(g.note, 1000),
        };
      })
      .sort((a, b) => a.id.localeCompare(b.id));
    const complete = bool(x.complete),
      singletonDeclaration = bool(x.singletonDeclaration);
    if (complete && !singletonDeclaration)
      throw Error("Confirm that you checked the remaining single images.");
    return { groups, complete, singletonDeclaration };
  }
  if (kind === "query") {
    if (!/^dev-(0[1-9]|1[0-2])$/.test(key))
      throw Error("Unknown development intent.");
    if (
      !["pending", "equivalent", "needs_revision"].includes(
        String(x.equivalence),
      )
    )
      throw Error("Invalid bilingual review status.");
    const q = {
      fr: text(x.fr, 300, true),
      en: text(x.en, 300, true),
      criterion: text(x.criterion, 1500, true),
      cluster: text(x.cluster, 100),
      note: text(x.note, 1000),
      equivalence: x.equivalence as Query["equivalence"],
      bilingualReviewer: text(x.bilingualReviewer, 100),
      authorDeclaration: bool(x.authorDeclaration),
    };
    if (!q.authorDeclaration)
      throw Error(
        "Confirm that you wrote the query wording yourself from visible concepts.",
      );
    if (q.equivalence !== "pending" && !q.bilingualReviewer)
      throw Error("Identify who checked the bilingual wording.");
    return q;
  }
  throw Error("Unknown review task.");
}
