import { defineTemplate } from "../../types";
import { Comment } from "./Comment";
import { buildTimeline } from "./timeline";

export { COMMENT, type CommentTimeline } from "./timeline";

/**
 * Template "comment" (コメント返信), ARCHITECTURE §5.10: a TikTok-style reply sticker (commenter + comment) pops over
 * the hook-slot footage and shrinks to the top-left; the main slot answers it with a big reply word that settles
 * into a reply bubble under the sticker; common end card.
 */
export const commentTemplate = defineTemplate({
  id: "comment",
  buildTimeline,
  Component: Comment,
});
