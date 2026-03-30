# Instagram DM Chatbot Automation (HEHO)

This project automates Instagram Direct Message replies by forwarding incoming messages to **HEHO AI** and sending the AI response back to Instagram.

## Setup

1. **Install dependencies:**
   ```bash
   npm install
   ```

2. **Configure environment variables** in `.env`:

   ```env
   INSTAGRAM_USERNAME=your_instagram_username
   INSTAGRAM_PASSWORD=your_instagram_password

   HEHO_API_KEY=your_heho_api_key
   HEHO_CHATBOT_ID=your_chatbot_id
   HEHO_API_URL=https://heho.vercel.app/api/aichat

   POLL_INTERVAL=4000
   MAX_HISTORY=20
   ```

3. **Run the bot:**
   ```bash
   npm start
   ```

## How it works

- Logs into Instagram using cookies (or credentials if cookies are missing/expired).
- Opens Instagram DM inbox.
- Reads latest incoming user message from the active thread.
- Sends message to HEHO `POST /api/aichat`.
- Receives AI response and sends reply on Instagram.
- Repeats in a polling loop.

## HEHO API format used

The bot sends requests like:

```json
{
  "chatbotId": "YOUR_AGENT_ID",
  "messages": [{ "role": "user", "content": "Hello?" }],
  "history": [{ "role": "user", "content": "Earlier message" }]
}
```

With headers:

- `Authorization: Bearer YOUR_HEHO_API_KEY`
- `Content-Type: application/json`

## Environment Variables

- `INSTAGRAM_USERNAME`: Instagram username
- `INSTAGRAM_PASSWORD`: Instagram password
- `HEHO_API_KEY`: HEHO API bearer token
- `HEHO_CHATBOT_ID`: HEHO chatbot ID
- `HEHO_API_URL`: HEHO endpoint (default: `https://heho.vercel.app/api/aichat`)
- `POLL_INTERVAL`: Poll delay in ms between checks (default: 4000)
- `MAX_HISTORY`: Number of recent messages sent as context (default: 20)

## Security

- Keep `.env` private.
- Do not hardcode tokens.
- Cookies are saved locally in `cookies.json` for session reuse.

## Note

Use responsibly and in compliance with Instagram and HEHO terms/policies.
