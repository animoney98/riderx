/** The Google Apps Script the owner pastes into the form. It posts each new response to RiderX. */
export function appsScript(host: string): string {
  return `const WEBHOOK_URL = 'https://${host}/api/leads';
const SECRET = 'PASTE-YOUR-SECRET-HERE';

function post_(list) {
  const res = UrlFetchApp.fetch(WEBHOOK_URL, {
    method: 'post',
    contentType: 'application/json',
    headers: { 'x-leads-secret': SECRET },
    payload: JSON.stringify({ responses: list }),
    muteHttpExceptions: true,
  });
  Logger.log(res.getResponseCode() + ' ' + res.getContentText());
  if (res.getResponseCode() !== 200) throw new Error('RiderX said: ' + res.getContentText());
}

function toItem_(r) {
  const answers = {};
  r.getItemResponses().forEach(function (ir) { answers[ir.getItem().getTitle()] = ir.getResponse(); });
  const email = r.getRespondentEmail();
  if (email && !answers['Email Address']) answers['Email Address'] = email;
  return { id: r.getId(), timestamp: r.getTimestamp().toISOString(), answers: answers };
}

// Runs by itself every time someone submits the form.
function onSubmit(e) { post_([toItem_(e.response)]); }

// Run this once by hand to send everyone who already filled the form. Safe to run again: nobody is added twice.
function sendAllExisting() {
  const all = FormApp.getActiveForm().getResponses();
  for (let i = 0; i < all.length; i += 50) post_(all.slice(i, i + 50).map(toItem_));
}
`;
}
