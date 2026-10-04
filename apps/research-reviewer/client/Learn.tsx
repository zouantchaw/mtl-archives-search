import { useState } from "react";
import { inspectionUrl } from "./inspection";
const questions = [
  {
    title: "You can see fields, roads and water, but do not know the location.",
    question: "Usable for visual search?",
    answer: "Yes",
    why: "Visible features can support search. Identifying the exact place is not needed.",
  },
  {
    title: "A clear “28” is visible on a strip of land; no words are visible.",
    question: "Readable text visible?",
    answer: "Yes",
    why: "Legible numbers count as text. Note what you read and where it appears.",
  },
  {
    title:
      "Black scan notches appear at the edge, with the photographed scene intact.",
    question: "Should you check Cropped?",
    answer: "No",
    why: "Fiducial marks and normal image boundaries alone are not missing scan content.",
  },
];
export function Learn() {
  const [tab, setTab] = useState("Rules"),
    [answers, setAnswers] = useState<Record<number, string>>({});
  return (
    <>
      <div className="learn-tabs" role="group" aria-label="Learning sections">
        {["Rules", "Examples", "Practice"].map((t) => (
          <button key={t} aria-pressed={tab === t} onClick={() => setTab(t)}>
            {t}
          </button>
        ))}
      </div>
      {tab === "Rules" ? (
        <div>
          <h2>Look, inspect, then decide</h2>
          <ol className="learn-steps">
            <li>Identify the kind of image from the pixels.</li>
            <li>Look for clear scene features someone could describe.</li>
            <li>
              Check the edges and small details for readable words or numbers.
            </li>
            <li>Use Unsure and a note when the evidence is ambiguous.</li>
          </ol>
          <p>
            <strong>Too dark / Blurred:</strong> flag serious loss of useful
            detail, not the age or black-and-white appearance of a photo.
          </p>
          <p>
            <strong>Cropped:</strong> flag scan content that appears
            accidentally cut off. Gray padding, a camera boundary and scan
            notches alone do not count.
          </p>
          <p>
            <strong>Optional model help:</strong> select an area, read the
            suggestion and verify it yourself. “Use as draft note” never chooses
            your answers. Saving records model exposure even when you dismiss
            the suggestion.
          </p>
        </div>
      ) : tab === "Examples" ? (
        <div className="learn-examples">
          <h2>Small details count</h2>
          <img
            src={inspectionUrl("003", { x: 0, y: 8500, w: 1400, h: 1500 }, 0)}
            alt="Magnified lower left margin of image 003"
          />
          <p>
            <strong>Check image margins.</strong> Numeric annotations can be
            easy to miss at Fit. Choose an edge, select a smaller area, or load
            Full image and zoom.
          </p>
          <img
            src="/api/media/002/preview"
            alt="Aerial fields with a numbered strip"
          />
          <p>
            <strong>Image 002:</strong> fields and a strip of land are visible
            search features. The readable “28” counts as text. You do not need
            to identify the exact location.
          </p>
          <p>
            <strong>Archive watermark:</strong> if readable, answer Yes for text
            and note that it is a watermark. It is separate from writing in the
            historical scene.
          </p>
        </div>
      ) : (
        <div>
          <h2>Try three quick checks</h2>
          <p>
            Practice only. These answers do not save or change your image
            reviews.
          </p>
          {questions.map((q, i) => (
            <fieldset className="practice-question" key={q.question}>
              <legend>
                {i + 1}. {q.question}
              </legend>
              <p>{q.title}</p>
              <div className="choices">
                {["Yes", "No", "Unsure"].map((a) => (
                  <button
                    key={a}
                    aria-pressed={answers[i] === a}
                    onClick={() => setAnswers({ ...answers, [i]: a })}
                  >
                    {a}
                  </button>
                ))}
              </div>
              {answers[i] && (
                <p
                  role="status"
                  className={
                    answers[i] === q.answer
                      ? "practice-correct"
                      : "practice-explanation"
                  }
                >
                  {answers[i] === q.answer
                    ? "Correct. "
                    : `For this example, choose ${q.answer}. `}
                  {q.why}
                </p>
              )}
            </fieldset>
          ))}
        </div>
      )}
    </>
  );
}
