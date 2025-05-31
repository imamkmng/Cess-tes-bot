import axios from 'axios';
import cfonts from 'cfonts';
import chalk from 'chalk';
import ora from 'ora';
import fs from 'fs/promises';
import { HttpsProxyAgent } from 'https-proxy-agent';
import { SocksProxyAgent } from 'socks-proxy-agent';
import { ethers } from 'ethers';
import { fileURLToPath } from 'url';
import path from 'path';

// Constants
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REFERRAL_URL = 'https://cess.network/deshareairdrop/?code=6164708';
const RPC_URL = "https://eth.merkle.io/";
const PLATFORM = "okex";
const MAX_ACCOUNTS = 5;
const DELAY_BETWEEN_ACCOUNTS = 30; // seconds

// Utility functions
function delay(seconds) {
  return new Promise(resolve => setTimeout(resolve, seconds * 1000));
}

function centerText(text, color = 'greenBright') {
  const terminalWidth = process.stdout.columns || 80;
  const textLength = text.length;
  const padding = Math.max(0, Math.floor((terminalWidth - textLength) / 2));
  return ' '.repeat(padding) + chalk[color](text);
}

function printSeparator() {
  console.log(chalk.bold.cyanBright('================================================================================'));
}

const userAgents = [
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.1 Safari/605.1.15',
  'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:109.0) Gecko/20100101 Firefox/120.0'
];

function getRandomUserAgent() {
  return userAgents[Math.floor(Math.random() * userAgents.length)];
}

// Core functionality
class CESSReferralBot {
  constructor() {
    this.proxies = [];
    this.existingKeys = [];
    this.generatedWallets = [];
  }

  async initialize() {
    await this.loadProxies();
    await this.loadExistingKeys();
    this.printBanner();
  }

  async loadProxies() {
    try {
      const data = await fs.readFile(path.join(__dirname, 'proxy.txt'), 'utf-8');
      this.proxies = data.split('\n').map(line => line.trim()).filter(line => line.length > 0);
    } catch (error) {
      console.error(chalk.red(`Error reading proxy.txt: ${error.message}`));
    }
  }

  async loadExistingKeys() {
    try {
      const data = await fs.readFile(path.join(__dirname, 'privatekey.txt'), 'utf-8');
      this.existingKeys = data.split('\n').map(line => line.trim()).filter(line => line.length > 0);
    } catch (error) {
      console.error(chalk.red(`Error reading privatekey.txt: ${error.message}`));
    }
  }

  printBanner() {
    cfonts.say('CESS Auto-Ref', {
      font: 'block',
      align: 'center',
      colors: ['cyan', 'magenta'],
      background: 'transparent',
      letterSpacing: 1,
      lineHeight: 1,
      space: true
    });
    console.log(centerText("=== Auto Referral Bot for CESS Network ==="));
    console.log(centerText(`Using ${this.existingKeys.length} existing wallets and ${this.proxies.length} proxies`));
    printSeparator();
  }

  generateWallet() {
    const wallet = ethers.Wallet.createRandom();
    return {
      address: wallet.address,
      privateKey: wallet.privateKey,
      mnemonic: wallet.mnemonic?.phrase
    };
  }

  getProxy(index) {
    if (this.proxies.length === 0) return null;
    return this.proxies[index % this.proxies.length];
  }

  getAxiosConfig(proxy, token = null) {
    const headers = {
      'User-Agent': getRandomUserAgent(),
      'Accept': 'application/json, text/plain, */*',
      'Content-Type': 'application/json',
      'Origin': 'https://cess.network',
      'Referer': REFERRAL_URL
    };
    
    if (token) headers['Authorization'] = `Bearer ${token}`;

    const config = { headers, timeout: 60000 };
    
    if (proxy) {
      if (proxy.startsWith('http://') || proxy.startsWith('https://')) {
        config.httpsAgent = new HttpsProxyAgent(proxy);
      } else if (proxy.startsWith('socks4://') || proxy.startsWith('socks5://')) {
        config.httpsAgent = new SocksProxyAgent(proxy);
      }
      config.proxy = false;
    }

    return config;
  }

  async getTokenFromPrivateKey(privateKey, proxy = null) {
    const provider = new ethers.JsonRpcProvider(RPC_URL);
    const wallet = new ethers.Wallet(privateKey, provider);
    const address = await wallet.getAddress();

    const uri = "https://cess.network/deshareairdrop";
    const version = "1";
    const timestampMs = Date.now();
    const nonce = makeNonce(PLATFORM, timestampMs);
    const issuedAt = makeIssuedAt(timestampMs);

    const message = `cess.network wants you to sign in with your account address:
${address}

Sign in to the app. Powered by cess.network Solutions.

URI: ${uri}
Version: ${version}
Nonce: ${nonce}
Issued At: ${issuedAt}`;

    const signature = await wallet.signMessage(message);

    const payload = {
      account: address,
      platform: PLATFORM,
      message,
      sign: signature
    };

    try {
      const res = await axios.post(
        "https://merklev2.cess.network/merkle/wlogin",
        payload,
        this.getAxiosConfig(proxy)
      );
      
      if (res.data.code === 200) {
        return res.data.data;
      } else {
        throw new Error(`Login failed: ${res.data.msg}`);
      }
    } catch (err) {
      throw new Error(`Login error: ${err.message}`);
    }
  }

  async registerAccount(wallet, proxy, index, total) {
    const spinner = ora({
      text: `Registering account ${index + 1}/${total} (${wallet.address})...`,
      spinner: 'dots',
      color: 'cyan'
    }).start();

    try {
      // Step 1: Get auth token
      const token = await this.getTokenFromPrivateKey(wallet.privateKey, proxy);
      
      // Step 2: Verify registration
      const statusRes = await axios.get(
        'https://merklev2.cess.network/merkle/task/status',
        this.getAxiosConfig(proxy, token)
      );

      if (statusRes.data.code === 200) {
        // Save successful registration
        await fs.appendFile(path.join(__dirname, 'privatekey.txt'), `${wallet.privateKey}\n`, 'utf-8');
        spinner.succeed(chalk.green(`Successfully registered: ${wallet.address}`));
        
        return {
          success: true,
          address: wallet.address,
          username: statusRes.data.data.account.username,
          points: statusRes.data.data.account.points
        };
      } else {
        throw new Error('Registration verification failed');
      }
    } catch (error) {
      spinner.fail(chalk.red(`Registration failed for ${wallet.address}: ${error.message}`));
      return { success: false, error: error.message };
    }
  }

  async run() {
    await this.initialize();

    // Generate needed wallets
    const neededWallets = Math.max(0, MAX_ACCOUNTS - this.existingKeys.length);
    if (neededWallets > 0) {
      console.log(chalk.yellow(`Generating ${neededWallets} new wallets...`));
      for (let i = 0; i < neededWallets; i++) {
        this.generatedWallets.push(this.generateWallet());
      }
    }

    // Process all wallets (existing + new)
    const allWallets = [
      ...this.existingKeys.map(pk => ({ privateKey: pk })),
      ...this.generatedWallets
    ];

    let successfulRegistrations = 0;
    
    for (let i = 0; i < allWallets.length; i++) {
      const wallet = allWallets[i];
      const proxy = this.getProxy(i);

      const result = await this.registerAccount(wallet, proxy, i, allWallets.length);
      if (result.success) successfulRegistrations++;

      // Delay between registrations
      if (i < allWallets.length - 1) {
        await delay(DELAY_BETWEEN_ACCOUNTS);
      }
    }

    printSeparator();
    console.log(chalk.bold.green(`Registration process completed!`));
    console.log(chalk.white(`Successfully registered: ${successfulRegistrations}/${allWallets.length} accounts`));
    console.log(chalk.white(`New accounts saved to privatekey.txt`));
    printSeparator();
  }
}

// Helper functions
function makeNonce(platform, timestampMs) {
  return Buffer.from(`${platform}-${timestampMs}`).toString("hex");
}

function makeIssuedAt(timestampMs) {
  return new Date(timestampMs).toISOString();
}

// Main execution
const bot = new CESSReferralBot();
bot.run().catch(err => {
  console.error(chalk.red(`Fatal error: ${err.message}`));
  process.exit(1);
});
