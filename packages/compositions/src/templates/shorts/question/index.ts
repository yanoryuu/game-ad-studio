import { defineTemplate } from "../../types";
import { Question } from "./Question";
import { buildTimeline } from "./timeline";

export { QUESTION, type QuestionPoll, type QuestionTimeline } from "./timeline";

/**
 * Template "question" (質問フック), ARCHITECTURE §5.10: the question slams in big at frame 0 and shrinks into the
 * top band; quick cuts of gameplay; poll buttons + comment prompt bubble in the last ~3 s; common end card.
 */
export const questionTemplate = defineTemplate({
  id: "question",
  buildTimeline,
  Component: Question,
});
