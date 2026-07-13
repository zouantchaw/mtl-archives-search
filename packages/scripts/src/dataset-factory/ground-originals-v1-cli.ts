import {
  acquire,
  buildBundle,
  derive,
  publishIndependentReview,
  restore,
  sealIndependentReview,
  sealPublication,
  selfTest,
  verify,
  verifyBundle,
  verifyIndependentReview,
} from "./ground-originals-v1.js";
const cmd = process.argv[2];
const result =
  cmd === "acquire"
    ? await acquire()
    : cmd === "derive" || cmd === "ocr"
      ? await derive()
      : cmd === "bundle"
        ? await buildBundle()
        : cmd === "publication-seal"
          ? sealPublication()
          : cmd === "review-seal"
            ? sealIndependentReview(process.argv[3], process.argv[4])
            : cmd === "review-publish"
              ? await publishIndependentReview()
              : cmd === "review-verify"
                ? verifyIndependentReview(process.argv[3], process.argv[4])
                : cmd === "bundle-verify"
                  ? verifyBundle(process.argv[3])
                  : cmd === "restore"
                    ? restore(process.argv[3], process.argv[4])
                    : cmd === "self"
                      ? await selfTest()
                      : cmd === "integration"
                        ? (await verify(false),
                          await selfTest(),
                          { offline: true, self: true })
                        : await verify(cmd === "verify-full");
console.log(JSON.stringify(result, null, 2));
