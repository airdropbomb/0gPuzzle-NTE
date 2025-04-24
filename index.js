import fs from 'fs';
import "dotenv/config";
import axios from 'axios';
import { Wallet } from 'ethers';
import ora from 'ora';
import { HttpsProxyAgent } from 'https-proxy-agent';
import { SocksProxyAgent } from 'socks-proxy-agent';
import cfonts from 'cfonts';
import readline from 'readline';
import chalk from 'chalk';

function askQuestion(query) {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });
  return new Promise(resolve => rl.question(query, ans => {
    rl.close();
    resolve(ans);
  }));
}

function logToFile(message) {
  try {
    const timestamp = new Date().toISOString();
    fs.appendFileSync('debug.log', `[${timestamp}] ${message}\n`, 'utf8');
  } catch (err) {
    console.error(chalk.red(`Failed to write to debug.log: ${err.message}`));
  }
}

function centerText(text, color = "cyanBright") {
  const terminalWidth = process.stdout.columns || 80;
  const padding = Math.max(0, Math.floor((terminalWidth - text.length) / 2));
  return " ".repeat(padding) + chalk[color](text);
}

function readProxiesFromFile(filename) {
  try {
    const content = fs.readFileSync(filename, 'utf8');
    return content.split('\n').map(line => line.trim()).filter(line => line !== '');
  } catch (err) {
    console.error(chalk.red("Failed to read proxy.txt file:", err.message));
    return [];
  }
}

cfonts.say("ADB NODE", {
  font: "block",
  align: "center",
  colors: ["cyan", "magenta"],
  background: "transparent",
  letterSpacing: 1,
  lineHeight: 1,
  space: true,
  maxLength: "0",
});
console.log(centerText("=== Telegram Channel 🚀 : ADB NODE (@airdropbombnode) ==="));

let proxyUrl = null;
let agent = null;
let axiosInstance = axios.create();

async function setupProxy() {
  const useProxy = await askQuestion(chalk.cyan("\nDo you want to use a proxy? (Y/n): "));
  if (useProxy.toLowerCase() === 'y') {
    const proxies = readProxiesFromFile('proxy.txt');
    if (proxies.length > 0) {
      proxyUrl = proxies[0];
      if (proxyUrl.startsWith('http://') || proxyUrl.startsWith('https://')) {
        agent = new HttpsProxyAgent(proxyUrl);
      } else if (proxyUrl.startsWith('socks5://')) {
        agent = new SocksProxyAgent(proxyUrl);
      } else {
        console.log(chalk.red("Unrecognized proxy format. Please use http/https or socks5."));
        return;
      }
      axiosInstance = axios.create({ httpAgent: agent, httpsAgent: agent });
      console.log(chalk.green(`Using proxy: ${proxyUrl}`));
    } else {
      console.log(chalk.red("proxy.txt file is empty or not found. Continuing without proxy."));
    }
  } else {
    console.log(chalk.blue("Continuing without proxy."));
  }
}

function shortAddress(address) {
  return `${address.slice(0, 8)}...${address.slice(-4)}`;
}

function formatCountdown(ms) {
  if (ms <= 0) return "00:00:00";
  const totalSeconds = Math.floor(ms / 1000);
  const hours = String(Math.floor(totalSeconds / 3600)).padStart(2, "0");
  const minutes = String(Math.floor((totalSeconds % 3600) / 60)).padStart(2, "0");
  const seconds = String(totalSeconds % 60).padStart(2, "0");
  return `${hours}:${minutes}:${seconds}`;
}

async function liveCountdown(durationMs) {
  const endTime = Date.now() + durationMs;
  return new Promise(resolve => {
    const timer = setInterval(() => {
      const remaining = Math.max(endTime - Date.now(), 0);
      process.stdout.write(chalk.yellow(`\rNext cycle in ${formatCountdown(remaining)} ...`));
      if (remaining <= 0) {
        clearInterval(timer);
        process.stdout.write("\n");
        resolve();
      }
    }, 1000);
  });
}

async function requestWithRetry(fn, maxRetries = 30, delayMs = 2000, debug = false) {
  let attempt = 0;
  while (attempt < maxRetries) {
    try {
      return await fn();
    } catch (err) {
      if (err.response && err.response.status === 429) {
        attempt++;
        if (debug) console.warn(chalk.yellow(`Attempt ${attempt}: Received 429, retrying in ${delayMs}ms...`));
        await new Promise(resolve => setTimeout(resolve, delayMs));
      } else {
        throw err;
      }
    }
  }
  throw new Error("Max retry attempts reached");
}

async function verifyTask(activityId, headers) {
  const payload = {
    operationName: "VerifyActivity",
    variables: { data: { activityId } },
    query:
      "mutation VerifyActivity($data: VerifyActivityInput!) {" +
      "  verifyActivity(data: $data) {" +
      "    record {" +
      "      id" +
      "      activityId" +
      "      status" +
      "      __typename" +
      "    }" +
      "    __typename" +
      "  }" +
      "}"
  };

  try {
    const response = await axiosInstance.post("https://api.deform.cc/", payload, { headers });
    const verifyData = response.data.data.verifyActivity;
    if (!verifyData || !verifyData.record) return false;
    return verifyData.record.status && verifyData.record.status.toUpperCase() === "COMPLETED";
  } catch (err) {
    return false;
  }
}

async function performCheckIn(activityId, headers) {
  const payload = {
    operationName: "VerifyActivity",
    variables: { data: { activityId } },
    query: `mutation VerifyActivity($data: VerifyActivityInput!) {
      verifyActivity(data: $data) {
        record {
          id
          activityId
          status
          properties
          createdAt
          rewardRecords {
            id
            status
            appliedRewardType
            appliedRewardQuantity
            appliedRewardMetadata
            error
            rewardId
            reward {
              id
              quantity
              type
              properties
              __typename
            }
            __typename
          }
          __typename
        }
        missionRecord {
          id
          missionId
          status
          createdAt
          rewardRecords {
            id
            status
            appliedRewardType
            appliedRewardQuantity
            appliedRewardMetadata
            error
            rewardId
            reward {
              id
              quantity
              type
              properties
              __typename
            }
            __typename
          }
          __typename
        }
        __typename
      }
    }`
  };

  try {
    const response = await requestWithRetry(
      () => axiosInstance.post("https://api.deform.cc/", payload, { headers }),
      3,
      2000
    );
    return response.data;
  } catch (err) {
    console.error(chalk.red("Error during check-in:", err.response ? err.response.data : err.message));
    return null;
  }
}

async function checkCheckInStatus(activityId, headers) {
  const payload = {
    operationName: "Campaign",
    variables: { campaignId: "f7e24f14-b911-4f11-b903-edac89a095ec" },
    query: `
      fragment ActivityFields on CampaignActivity {
        id
        title
        createdAt
        records {
          id
          status
          createdAt
          __typename
        }
        __typename
      }
      query Campaign($campaignId: String!) {
        campaign(id: $campaignId) {
          activities {
            ...ActivityFields
            __typename
          }
          __typename
        }
      }`
  };

  try {
    const response = await axiosInstance.post("https://api.deform.cc/", payload, { headers });
    const campaignData = response.data.data.campaign;
    const dailyCheckin = campaignData.activities.find(act =>
      act.title && act.title.toLowerCase().includes("daily check-in") && act.id === activityId
    );

    if (dailyCheckin && dailyCheckin.records && dailyCheckin.records.length > 0) {
      const sortedRecords = dailyCheckin.records.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
      const latestRecord = sortedRecords[0];
      const recordDate = new Date(latestRecord.createdAt);
      const today = new Date();
      const isToday = recordDate.getUTCFullYear() === today.getUTCFullYear() &&
                      recordDate.getUTCMonth() === today.getUTCMonth() &&
                      recordDate.getUTCDate() === today.getUTCDate();
      if (isToday && ["COMPLETED", "VERIFIED"].includes(latestRecord.status.toUpperCase())) {
        return "Already check-in today";
      }
      return "Not checked in";
    }
    return "Not checked in";
  } catch (err) {
    console.error(chalk.red("Error while checking check-in status:", err.response ? err.response.data : err.message));
    return "Error";
  }
}

async function doLogin(walletKey, debug = false) {
  try {
    return await requestWithRetry(async () => {
      const wallet = new Wallet(walletKey);
      const address = wallet.address;

      const privyHeaders = {
        "Host": "auth.privy.io",
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/134.0.0.0 Safari/537.36",
        "Content-Type": "application/json",
        "privy-app-id": "clphlvsh3034xjw0fvs59mrdc",
        "privy-ca-id": "94f3cea1-8c2b-478d-90da-edc794f7114b",
        "privy-client": "react-auth:2.4.1",
        "Origin": "https://puzzlemania.0g.ai",
        "Referer": "https://puzzlemania.0g.ai/"
      };

      const initResponse = await axiosInstance.post("https://auth.privy.io/api/v1/siwe/init", { address }, { headers: privyHeaders });
      const { nonce } = initResponse.data;
      const issuedAt = new Date().toISOString();
      const message = `puzzlemania.0g.ai wants you to sign in with your Ethereum account:
${address}

By signing, you are proving you own this wallet and logging in. This does not initiate a transaction or cost any fees.

URI: https://puzzlemania.0g.ai
Version: 1
Chain ID: 8453
Nonce: ${nonce}
Issued At: ${issuedAt}
Resources:
- https://privy.io`;

      const signature = await wallet.signMessage(message);
      const authPayload = {
        message,
        signature,
        chainId: "eip155:8453",
        walletClientType: "metamask",
        connectorType: "injected",
        mode: "login-or-sign-up"
      };
      const authResponse = await axiosInstance.post("https://auth.privy.io/api/v1/siwe/authenticate", authPayload, { headers: privyHeaders });
      const { token, user } = authResponse.data;
      let displayName = "Unknown";
      if (user && user.linked_accounts) {
        const twitterAcc = user.linked_accounts.find(acc => acc.type === "twitter_oauth" && acc.name);
        if (twitterAcc) displayName = twitterAcc.name.split("|")[0].trim();
      }

      const userLoginPayload = {
        operationName: "UserLogin",
        variables: { data: { externalAuthToken: token } },
        query: `mutation UserLogin($data: UserLoginInput!) {
          userLogin(data: $data)
        }`
      };
      const deformLoginHeaders = {
        "content-type": "application/json",
        "origin": "https://puzzlemania.0g.ai",
        "x-apollo-operation-name": "UserLogin"
      };
      const userLoginResponse = await axiosInstance.post("https://api.deform.cc/", userLoginPayload, { headers: deformLoginHeaders });
      const userLoginToken = userLoginResponse.data.data.userLogin;

      return { userLoginToken, displayName, wallet, address, loginTime: Date.now() };
    }, 30, 2000, debug);
  } catch (err) {
    console.error(chalk.red(`Login failed for account ${shortAddress((new Wallet(walletKey)).address)}: ${err.message}`));
    return null;
  }
}

async function runCycleOnce(walletKey) {
  const loginSpinner = ora(chalk.cyan("Processing login...")).start();
  const loginData = await doLogin(walletKey, false);
  if (!loginData) {
    loginSpinner.fail(chalk.red("Login failed after maximum attempts. Skipping account."));
    return;
  }
  loginSpinner.succeed(chalk.green("Login Successful"));

  const { userLoginToken, displayName, address, loginTime } = loginData;

  const userMePayload = {
    operationName: "UserMe",
    variables: { campaignId: "f7e24f14-b911-4f11-b903-edac89a095ec" },
    query: `
      query UserMe($campaignId: String!) {
        userMe {
          campaignSpot(campaignId: $campaignId) {
            points
            records {
              id
              status
              createdAt
            }
          }
        }
      }`
  };
  const userMeHeaders = {
    "authorization": `Bearer ${userLoginToken}`,
    "content-type": "application/json",
    "x-apollo-operation-name": "UserMe"
  };
  let userMePoints = 0;
  try {
    const response = await axiosInstance.post("https://api.deform.cc/", userMePayload, { headers: userMeHeaders });
    userMePoints = response.data.data.userMe.campaignSpot.points || 0;
  } catch (err) {
    console.error(chalk.red("Error while fetching UserMe XP:", err.response ? err.response.data : err.message));
  }

  const campaignPayload = {
    operationName: "Campaign",
    variables: { campaignId: "f7e24f14-b911-4f11-b903-edac89a095ec" },
    query: `
      fragment ActivityFields on CampaignActivity {
        id
        title
        createdAt
        records {
          id
          status
          createdAt
          __typename
        }
        __typename
      }
      query Campaign($campaignId: String!) {
        campaign(id: $campaignId) {
          activities {
            ...ActivityFields
            __typename
          }
          __typename
        }
      }`
  };
  const campaignHeaders = {
    "authorization": `Bearer ${userLoginToken}`,
    "content-type": "application/json",
    "x-apollo-operation-name": "Campaign"
  };
  let campaignData;
  try {
    const campaignResponse = await axiosInstance.post("https://api.deform.cc/", campaignPayload, { headers: campaignHeaders });
    campaignData = campaignResponse.data.data.campaign;
  } catch (err) {
    console.error(chalk.red("Campaign Error:", err.response ? err.response.data : err.message));
    throw err;
  }
  if (!campaignData) throw new Error("Campaign data not found");

  let dailyCheckin = campaignData.activities.find(act =>
    act.title && act.title.toLowerCase().includes("daily check-in")
  );
  let claimedTasks = [];
  let unclaimedTasks = [];
  campaignData.activities.forEach(act => {
    if (dailyCheckin && act.id === dailyCheckin.id) return;
    if (act.records && act.records.length > 0) {
      claimedTasks.push(act);
    } else {
      unclaimedTasks.push(act);
    }
  });

  let checkinStatus = "Not checked in";
  if (dailyCheckin) {
    checkinStatus = await checkCheckInStatus(dailyCheckin.id, campaignHeaders);
    console.log(chalk.yellow(`Check-in status from server: ${checkinStatus}`));
    if (checkinStatus === "Not checked in") {
      const spinnerCheckin = ora(chalk.cyan(`Performing check-in for: ${dailyCheckin.title}`)).start();
      try {
        const checkInResponse = await performCheckIn(dailyCheckin.id, campaignHeaders);
        spinnerCheckin.stop();
        if (!checkInResponse) {
          checkinStatus = "Check-in Failed";
          console.log(chalk.red("Check-in failed: No response from server."));
        } else if (
          checkInResponse?.data?.verifyActivity?.record?.status?.toUpperCase() === "COMPLETED"
        ) {
          checkinStatus = "Check-in Successful";
          dailyCheckin.records = [checkInResponse.data.verifyActivity.record];
          console.log(chalk.green("Check-in successfully completed."));
        } else if (
          checkInResponse?.data?.errors?.some(err => 
            err.message?.toLowerCase().includes("already checked in") ||
            err.message?.toLowerCase().includes("already completed") ||
            err.message?.toLowerCase().includes("already verified")
          )
        ) {
          checkinStatus = "Already check-in today";
          console.log(chalk.green("Already check-in today."));
        } else {
          checkinStatus = "Check-in Failed";
          console.log(chalk.red("Check-in failed, check connection or server."));
        }
      } catch (err) {
        spinnerCheckin.stop();
        checkinStatus = "Check-in Failed";
        console.log(chalk.red("Check-in failed: " + (err.response ? JSON.stringify(err.response.data) : err.message)));
      }
    } else if (checkinStatus === "Already check-in today") {
      console.log(chalk.green("Already check-in today."));
      checkinStatus = "Already check-in today";
    } else if (checkinStatus === "Error") {
      console.log(chalk.red("Failed to check check-in status, try again later."));
      checkinStatus = "Error";
    }
  } else {
    console.log(chalk.red("Daily check-in activity not found."));
    checkinStatus = "Not Available";
  }

  console.clear();
  console.log(chalk.magenta('\n==========================================================================='));
  console.log(chalk.blueBright.bold('                         USER INFORMATION'));
  console.log(chalk.magenta('============================================================================'));
  console.log(chalk.cyanBright(`Name          : ${displayName}`));
  console.log(chalk.cyanBright(`Address       : ${shortAddress(address)}`));
  console.log(chalk.cyanBright(`XP            : ${userMePoints}`));
  console.log(chalk.cyanBright(`Daily Checkin : ${checkinStatus}`));
  console.log(chalk.cyanBright(`Proxy         : ${proxyUrl || "None"}`));
  console.log(chalk.magenta('============================================================================'));

  console.log(chalk.magenta('\n----------------------------- Claimed Tasks ----------------------------\n'));
  if (claimedTasks.length === 0) {
    console.log(chalk.red('(No tasks have been claimed)\n'));
  } else {
    claimedTasks.forEach(task => {
      console.log(chalk.green(`[VERIFIED] Task: ${task.title} => Already Claimed`));
    });
    console.log('');
  }
  console.log(chalk.magenta('------------------------------------------------------------------------\n'));

  console.log(chalk.magenta('---------------------------- Unclaimed Tasks ---------------------------\n'));
  if (unclaimedTasks.length === 0) {
    console.log(chalk.red('(No unclaimed tasks)\n'));
  } else {
    for (const task of unclaimedTasks) {
      const spinnerTask = ora(chalk.cyan(`Verifying: ${task.title}`)).start();
      const verified = await verifyTask(task.id, campaignHeaders);
      spinnerTask.stop();
      if (verified) {
        console.log(chalk.green(`[VERIFIED] Task: ${task.title} => Claimed`));
      } else {
        console.log(chalk.red(`[UNVERIFIED] Task: ${task.title}`));
      }
    }
  }
  console.log(chalk.magenta('------------------------------------------------------------------------\n'));
}

async function mainLoopRoundRobin() {
  await setupProxy();

  const accounts = readPrivateKeysFromFile('.env');
  if (!accounts.length) {
    console.error(chalk.red("No private keys found in .env file"));
    process.exit(1);
  }

  while (true) {
    const cycleStart = Date.now();
    for (const key of accounts) {
      console.log(chalk.cyan(`Processing account: ${shortAddress((new Wallet(key)).address)}\n`));
      try {
        await runCycleOnce(key);
      } catch (err) {
        console.error(chalk.red(`Error for account ${shortAddress((new Wallet(key)).address)}: ${err.message}`));
      }
      await new Promise(resolve => setTimeout(resolve, 3000));
    }
    const cycleDuration = 24 * 60 * 60 * 1000 + 4 * 60 * 1000;
    const elapsed = Date.now() - cycleStart;
    const remaining = cycleDuration - elapsed;
    if (remaining > 0) {
      await liveCountdown(remaining);
    }
  }
}

function readPrivateKeysFromFile(filename) {
  try {
    const content = fs.readFileSync(filename, 'utf8');
    return content.split('\n').map(line => line.trim()).filter(line => line !== '');
  } catch (err) {
    console.error(chalk.red("Failed to read .env file:", err.message));
    process.exit(1);
  }
}

mainLoopRoundRobin().catch(err => console.error(chalk.red("A fatal error occurred:", err.message)));
