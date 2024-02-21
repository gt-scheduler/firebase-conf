import { sendEmail } from "./connectMailer";

const semesterMapping: Record<string, string> = {
  "02": "Spring",
  "05": "Summer",
  "08": "Fall",
};

const termToString = (term: string): string => {
  if (term.length !== 6) return "Unknown";
  const semester = semesterMapping[term.slice(4)];
  if (!semester) return "Unknown";
  const year = term.slice(0, 4);
  return `${semester} ${year}`;
};

interface SendInvitationParameters {
  inviteId: string;
  senderEmail: string;
  friendEmail: string;
  term: string;
  versionNames: string[];
  url?: string;
}

export default async function sendInvitation({
  inviteId,
  senderEmail,
  friendEmail,
  term,
  versionNames,
  url,
}: SendInvitationParameters): Promise<void> {
  const inviteUrl = url + `/#/invite/${inviteId}`;
  const semester = termToString(term);
  const subject = "Friend Schedule Invite";
  const text = `
  You have been invited to a GT schedule by ${senderEmail}
  \tSemester: ${semester}
  \tVersion: ${versionNames.join(", ")}
  Accept the invite: ${inviteUrl}
  `;
  const html = `
    <div style="width:600px;">
      <div class="header" style="background-image:linear-gradient(to right, #FF5B54, #FFBA4E); height:88px; 
      font-weight:bold; color:white; font-size:48px; padding-left: 11px;
      padding-top: 10px;">GT Scheduler</div>
      <div class="body-text" style="background-color:#222222; padding:20px;">
        <h1 style="color: white;
        font-size: 24px;">Invitation to View Schedule</h1>  
        <p style="color: white;">Hello,</p>
        <p style="color: white;">You have been invited to a GT schedule by <a href="mailto:${senderEmail}" style="color:#1456D3">${senderEmail}</a> 
        to import their schedule "<b>${versionNames.join(
          ", "
        )}</b>" for the ${semester}. Accepting this invite
        allows you to compare this schedule to others in you Shared Schedule panel when turned on. 
        You can always remove this schedule from your view in the site after importing it if you 
        chose to do so.</p>
        <p style="color: white;">Please click the link below to accept this invitation.</p>
        <a href="${inviteUrl}" style="color:#FE5B53">${inviteUrl}</a>
        <p style="color: white;">For any inquiries, please contact us at <a href="contact@gt-scheduler.org" style="color:#FE5B53">contact@gt-scheduler.org</a></p>
        <p style="color: white;">The GT Scheduler Team @<b>Bits of Good</b></p>
        <div style="display: flex;flex-direction: row;justify-content: center;
        color: white;font-size: 24px;">
          <img src="https://drive.google.com/file/d/1VwCN1aqj3NoC1w5xnvSQ__jc1wCqQuHF/view?usp=share_link" alt="Bog Logo" style="width:18px; height:24px;">
          <p>bits of good</p>
        </div>
        </div>
    </div>
  `;
  await sendEmail(friendEmail, subject, text, html);
}
