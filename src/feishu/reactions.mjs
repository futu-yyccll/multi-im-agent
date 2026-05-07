import { runLarkCliJson } from "./cli.mjs";

export async function addWorkingReaction(messageId, config, log) {
  if (!config.reactionsEnabled || !config.workingReaction) {
    return null;
  }

  try {
    const result = await runLarkCliJson(
      [
        "im",
        "reactions",
        "create",
        "--params",
        JSON.stringify({ message_id: messageId }),
        "--data",
        JSON.stringify({ reaction_type: { emoji_type: config.workingReaction } }),
        "--as",
        "bot",
        "--format",
        "json",
      ],
      { larkProfile: config.larkProfile },
    );
    const reactionId = extractReactionId(result);
    if (!reactionId) {
      log?.(`working reaction created without reaction_id for ${messageId}`);
      return null;
    }

    return {
      message_id: messageId,
      reaction_id: reactionId,
      emoji_type: config.workingReaction,
    };
  } catch (error) {
    log?.(`failed to add working reaction to ${messageId}: ${error.message}`);
    return null;
  }
}

export async function clearWorkingReactions(events, config, log) {
  if (!config.reactionsEnabled) {
    return;
  }

  for (const event of events) {
    const reaction = event.workingReaction;
    if (!reaction?.message_id || !reaction?.reaction_id) {
      continue;
    }

    try {
      await runLarkCliJson(
        [
          "im",
          "reactions",
          "delete",
          "--params",
          JSON.stringify({
            message_id: reaction.message_id,
            reaction_id: reaction.reaction_id,
          }),
          "--as",
          "bot",
          "--format",
          "json",
        ],
        { larkProfile: config.larkProfile },
      );
    } catch (error) {
      log?.(`failed to clear working reaction from ${reaction.message_id}: ${error.message}`);
    }
  }
}

export async function addErrorReactions(events, config, log) {
  if (!config.reactionsEnabled || !config.errorReaction) {
    return;
  }

  for (const event of events) {
    const messageId = event.message_id || event.id;
    if (!messageId) {
      continue;
    }

    try {
      await runLarkCliJson(
        [
          "im",
          "reactions",
          "create",
          "--params",
          JSON.stringify({ message_id: messageId }),
          "--data",
          JSON.stringify({ reaction_type: { emoji_type: config.errorReaction } }),
          "--as",
          "bot",
          "--format",
          "json",
        ],
        { larkProfile: config.larkProfile },
      );
    } catch (error) {
      log?.(`failed to add error reaction to ${messageId}: ${error.message}`);
    }
  }
}

function extractReactionId(result) {
  return (
    result?.data?.reaction_id ||
    result?.reaction_id ||
    result?.data?.item?.reaction_id ||
    result?.data?.reaction?.reaction_id ||
    ""
  );
}
