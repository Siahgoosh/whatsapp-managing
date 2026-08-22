import { config } from "../../config/index.js";
import { getDb, getSetting } from "../../database/index.js";
import { logger } from "../../backend/src/utils/logger.js";

export class AiService {
  enabled() {
    return config.aiEnabled && Boolean(config.aiApiKey);
  }

  mode() {
    return getSetting("ai_mode", "suggest");
  }

  async suggest({ history = [], incoming, contactName = "" }) {
    if (!this.enabled()) return null;
    const messages = [
      {
        role: "system",
        content:
          "You are a helpful Persian real-estate assistant. Suggest a short polite reply. Do not request private data. Do not impersonate WhatsApp support."
      },
      ...history.slice(-8).map((m) => ({
        role: m.direction === "out" ? "assistant" : "user",
        content: m.body
      })),
      {
        role: "user",
        content: `Contact: ${contactName}\nIncoming: ${incoming}\nWrite a suggested reply in Persian.`
      }
    ];
    try {
      const res = await fetch(`${config.aiBaseUrl}/chat/completions`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${config.aiApiKey}`,
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          model: config.aiModel,
          messages,
          temperature: 0.4,
          max_tokens: 300
        })
      });
      if (!res.ok) {
        logger.warn({ status: res.status }, "ai suggest failed");
        return null;
      }
      const data = await res.json();
      return data.choices?.[0]?.message?.content?.trim() || null;
    } catch (err) {
      logger.warn({ err: err.message }, "ai suggest error");
      return null;
    }
  }
}

export const aiService = new AiService();
