// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-nocheck
import * as nodemailer from "nodemailer";

export default async function connectMailer() {
  return nodemailer.createTransport({
    host: process.env.NODEMAILER_HOST ?? "",
    port: process.env.NODEMAILER_PORT ?? "",
    secure: true,
    auth: {
      user: process.env.NODEMAILER_USERNAME ?? "",
      pass: process.env.NODEMAILER_PASSWORD ?? "",
    },
    tls: {
      rejectUnauthorized: false,
    },
  });
}

export async function sendEmail(email: String, subject: String, text: String, html: String) {
  const transporter = await connectMailer();
  const info = await transporter.sendMail({
    from: process.env.NODEMAILER_EMAIL, // sender address
    to: email, // list of receivers
    subject, // Subject line
    text, // plain text body
    html, // html body
  });
  return info;
}
