// Placeholder so the tests compile; implemented in the next commit.
export class MemoryMailer {
  readonly sent: { to: string; subject: string; text: string }[] = [];
  fail(_fail: boolean): void {}
}
