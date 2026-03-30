// Instagram DM Chatbot Automation Script

require('dotenv').config();
const { PuppeteerCrawler, log } = require('crawlee');
const fs = require('fs');
const path = require('path');

// Environment variables
const INSTAGRAM_USERNAME = process.env.INSTAGRAM_USERNAME;
const INSTAGRAM_PASSWORD = process.env.INSTAGRAM_PASSWORD;
const HEHO_API_KEY = process.env.HEHO_API_KEY;
const HEHO_CHATBOT_ID = process.env.HEHO_CHATBOT_ID;
const HEHO_API_URL = process.env.HEHO_API_URL || 'https://heho.vercel.app/api/aichat';
const POLL_INTERVAL = parseInt(process.env.POLL_INTERVAL || '4000', 10);
const MAX_HISTORY = parseInt(process.env.MAX_HISTORY || '20', 10);

// Validate environment variables
if (!INSTAGRAM_USERNAME || !INSTAGRAM_PASSWORD) {
  log.error('Missing required environment variables: INSTAGRAM_USERNAME and INSTAGRAM_PASSWORD');
  process.exit(1);
}

if (!HEHO_API_KEY || !HEHO_CHATBOT_ID) {
  log.error('Missing required environment variables: HEHO_API_KEY and HEHO_CHATBOT_ID');
  process.exit(1);
}

const LOGIN_URL = 'https://www.instagram.com/accounts/login/';
const INBOX_URL = 'https://www.instagram.com/direct/inbox/';
const COOKIE_PATH = path.resolve(__dirname, '..', 'cookies.json');

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// In-memory state to avoid duplicate replies
const repliedMessageIds = new Set();

const loadCookies = async (page) => {
  try {
    if (fs.existsSync(COOKIE_PATH)) {
      const data = fs.readFileSync(COOKIE_PATH, 'utf-8');
      if (data.trim()) {
        const cookies = JSON.parse(data);
        await page.setCookie(...cookies);
        log.info('✅ Cookies loaded successfully!');
        return true;
      }
    }
  } catch (err) {
    log.error('Error loading cookies: ' + err.message);
  }
  return false;
};

const saveCookies = async (page) => {
  const cookies = await page.cookies();
  fs.writeFileSync(COOKIE_PATH, JSON.stringify(cookies, null, 2));
  log.info('✅ Cookies saved successfully!');
};

const dismissInstagramPopups = async (page) => {
  const dismissTexts = ['Not Now', 'Cancel'];

  for (const text of dismissTexts) {
    try {
      const buttons = await page.$$('button');
      for (const button of buttons) {
        const label = await page.evaluate((el) => el.textContent?.trim(), button);
        if (label === text) {
          await button.click();
          await sleep(500);
          break;
        }
      }
    } catch {
      // Popup did not appear
    }
  }
};

const ensureLoggedIn = async (page) => {
  const cookiesLoaded = await loadCookies(page);

  await page.goto(LOGIN_URL, { waitUntil: 'networkidle2' });

  const isAlreadyLoggedIn = await page
    .$eval('body', (body) => !body.innerText.toLowerCase().includes('log in'))
    .catch(() => false);

  if (cookiesLoaded && isAlreadyLoggedIn) {
    log.info('✅ Session active via cookies.');
    return;
  }

  log.info('🔐 Logging in using credentials...');
  await page.waitForSelector('input[name="username"]', { visible: true });
  await page.type('input[name="username"]', INSTAGRAM_USERNAME, { delay: 50 });

  await page.waitForSelector('input[name="password"]', { visible: true });
  await page.type('input[name="password"]', INSTAGRAM_PASSWORD, { delay: 50 });

  await page.waitForSelector('button[type="submit"]', { visible: true });
  await page.click('button[type="submit"]');

  await page.waitForNavigation({ waitUntil: 'networkidle2' });
  await saveCookies(page);
};

const collectConversation = async (page) => {
  return page.evaluate((maxHistory) => {
    const msgNodes = Array.from(document.querySelectorAll('div[role="main"] [dir="auto"]'));
    const conversation = [];

    for (const node of msgNodes) {
      const content = node.textContent?.trim();
      if (!content) continue;

      const parent = node.closest('div');
      const className = parent?.className || '';
      const role = className.includes('x1s688f') || className.includes('x1iyjqo2') ? 'assistant' : 'user';

      conversation.push({
        role,
        content,
      });
    }

    return conversation.slice(-maxHistory);
  }, MAX_HISTORY);
};

const getLatestIncomingMessage = async (page) => {
  return page.evaluate(() => {
    const nodes = Array.from(document.querySelectorAll('div[role="main"] [dir="auto"]'));
    if (!nodes.length) return null;

    for (let i = nodes.length - 1; i >= 0; i--) {
      const node = nodes[i];
      const content = node.textContent?.trim();
      if (!content) continue;

      const bubble = node.closest('div');
      const className = bubble?.className || '';

      // Heuristic: incoming messages usually do not carry sender-bubble classes used for own outgoing bubble.
      const isOutgoing = className.includes('x1iyjqo2') || className.includes('x1s688f');
      if (!isOutgoing) {
        return {
          id: node.getAttribute('id') || `${content}-${i}`,
          content,
        };
      }
    }

    return null;
  });
};

const askHeho = async ({ message, history }) => {
  const response = await fetch(HEHO_API_URL, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${HEHO_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      chatbotId: HEHO_CHATBOT_ID,
      messages: [{ role: 'user', content: message }],
      history,
    }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`HEHO API error ${response.status}: ${errorText}`);
  }

  const data = await response.json();

  const possibleReply =
    data?.respond ||
    data?.response ||
    data?.reply ||
    data?.message ||
    data?.data?.respond ||
    data?.data?.response;

  if (!possibleReply || typeof possibleReply !== 'string') {
    throw new Error('HEHO response did not contain a valid reply text.');
  }

  return possibleReply.trim();
};

const sendInstagramReply = async (page, text) => {
  const textboxSelector = 'div[role="textbox"]';
  await page.waitForSelector(textboxSelector, { visible: true, timeout: 20000 });
  await page.click(textboxSelector);
  await page.keyboard.type(text);

  const buttons = await page.$$('button');
  let clicked = false;

  for (const button of buttons) {
    const label = await page.evaluate((el) => el.textContent?.trim(), button);
    if (label === 'Send') {
      await button.click();
      clicked = true;
      break;
    }
  }

  if (!clicked) await page.keyboard.press('Enter');
};

const runChatbotLoop = async (page) => {
  log.info('🤖 Chatbot automation started. Watching incoming messages...');

  while (true) {
    try {
      await page.goto(INBOX_URL, { waitUntil: 'networkidle2' });
      await dismissInstagramPopups(page);

      // Open the first thread
      const firstThreadSelector = 'div[role="main"] a[href*="/direct/t/"]';
      await page.waitForSelector(firstThreadSelector, { visible: true, timeout: 20000 });
      await page.click(firstThreadSelector);

      await page.waitForSelector('div[role="main"]', { visible: true, timeout: 20000 });

      const latestIncoming = await getLatestIncomingMessage(page);
      if (!latestIncoming) {
        log.info('No incoming message found in the thread.');
        await sleep(POLL_INTERVAL);
        continue;
      }

      if (repliedMessageIds.has(latestIncoming.id)) {
        await sleep(POLL_INTERVAL);
        continue;
      }

      log.info(`📩 New incoming message: ${latestIncoming.content}`);

      const history = await collectConversation(page);
      const aiReply = await askHeho({ message: latestIncoming.content, history });

      if (!aiReply) {
        log.warn('HEHO returned empty response. Skipping send.');
        repliedMessageIds.add(latestIncoming.id);
        await sleep(POLL_INTERVAL);
        continue;
      }

      await sendInstagramReply(page, aiReply);
      repliedMessageIds.add(latestIncoming.id);
      log.info(`✅ Sent reply: ${aiReply}`);
    } catch (error) {
      log.error('Chatbot loop error: ' + error.message);
    }

    await sleep(POLL_INTERVAL);
  }
};

(async () => {
  const crawler = new PuppeteerCrawler({
    maxConcurrency: 1,
    launchContext: {
      launchOptions: {
        headless: false,
        args: ['--start-maximized'],
      },
    },

    requestHandler: async ({ page }) => {
      await ensureLoggedIn(page);
      await page.goto(INBOX_URL, { waitUntil: 'networkidle2' });
      await runChatbotLoop(page);
    },

    failedRequestHandler: async ({ request, error }) => {
      log.error(`Request ${request.url} failed: ${error.message}`);
    },
  });

  await crawler.addRequests([{ url: LOGIN_URL }]);
  await crawler.run();
})();
