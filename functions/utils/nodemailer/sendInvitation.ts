// @ts-nocheck
import { sendEmail } from "./connectMailer";

const semesterMapping = {
  "02": "Spring",
  "05": "Summer",
  "08": "Fall",
};

const baseUrl = process.env["FUNCTIONS_EMULATOR"] ? "http://localhost:3000/" : "https://gt-scheduler.org/";
const termToString = (term: String): String => {
  const semester = semesterMapping[term.slice(4)];
  const year = term.slice(0, 4);
  return `${semester} ${year}`;
}

export default async function sendInvitation(inviteId: String, senderEmail, friendEmail: String, term: String, versionName: String): Promise<void> {
  const inviteUrl = baseUrl + `invite/${inviteId}`;
  const semester = termToString(term);
  const subject = "Friend Schedule Invite";
  const text = `
  You have been invited to a GT schedule by ${senderEmail}
  \tSemester: ${semester}
  \tVersion: ${versionName}
  Accept the invite: ${inviteUrl}
  `;
  const html = `
    <div>
      <p>You have been invited to a GT schedule by <a href="mailto:${senderEmail}">${senderEmail}</a></p>
      <p>&emsp;Semester: ${semester}</p>
      <p>&emsp;Version: ${versionName}</p>
      <p>Accept the invite: <a href="${inviteUrl}">${inviteUrl}</a></p>
    </div>
  `
  await sendEmail(friendEmail, subject, text, html);
}
