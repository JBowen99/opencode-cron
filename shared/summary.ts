export const SUMMARY_TIMEOUT_SEC = 120;

export const SUMMARY_PROMPT = `The scheduled task is over. Write the report that will appear in this job's run history.

Do not use any tools and do not change any files. Answer from what already happened in this session.

Rules:
- The first line is exactly "STATUS: done" or "STATUS: failed", with nothing else on that line.
  - done: the task was completed. A run where there was nothing to do, such as no new mail, is done.
  - failed: the task was not completed or was only partly completed. For example, access was denied, a file, page, or service the task needs was missing or broken, you could not finish in time, or you stopped early.
- The second line is one sentence saying what happened, for example "Filed 3 new invoices in invoices.md." or "Could not read the inbox because the login was rejected." It is shown on its own in the run list.
- Then, only if there is more worth knowing, add up to 6 short bullets starting with "- ": what you found, what you changed (name the files), and anything that failed or needs a person to act. If nothing went wrong, do not add a bullet saying so.
- Leave out the steps you took to get there, tool names, and pleasantries.
- Plain text only, no headings, no code blocks, under 120 words.`;
