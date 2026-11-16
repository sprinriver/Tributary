// nodemailer ships no TypeScript types; this covers the part we use (createTransport(url).sendMail).
declare module 'nodemailer' {
  interface Transporter {
    sendMail(message: { from: string; to: string; subject: string; text: string }): Promise<unknown>;
  }
  export function createTransport(url: string): Transporter;
  const nodemailer: { createTransport: typeof createTransport };
  export default nodemailer;
}
