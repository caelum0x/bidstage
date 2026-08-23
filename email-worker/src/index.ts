type SupportMailEnv = {
  SUPPORT_FORWARD_TO: string;
};

type IncomingEmail = {
  from: string;
  to: string;
  rawSize: number;
  headers: Headers;
  setReject(reason: string): void;
  forward(recipient: string, headers?: Headers): Promise<void>;
};

const SUPPORT_ADDRESS = "support@bidstage.app";
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export default {
  async email(message: IncomingEmail, env: SupportMailEnv): Promise<void> {
    if (message.to.toLowerCase() !== SUPPORT_ADDRESS) {
      message.setReject("This Bidstage mailbox does not exist");
      return;
    }
    const destination = env.SUPPORT_FORWARD_TO?.trim().toLowerCase();
    if (!destination || !EMAIL_PATTERN.test(destination) || destination === SUPPORT_ADDRESS) {
      throw new Error("SUPPORT_FORWARD_TO is missing or invalid");
    }

    const forwardingHeaders = new Headers();
    forwardingHeaders.set("X-Bidstage-Mailbox", SUPPORT_ADDRESS);
    forwardingHeaders.set("X-Bidstage-Envelope-From", message.from.slice(0, 320));
    await message.forward(destination, forwardingHeaders);
  },
};
