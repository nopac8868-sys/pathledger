import express from 'express';
import { createServer as createViteServer } from 'vite';
import path from 'path';
import multer from 'multer';
import Stripe from 'stripe';
import { Client, Wallet, NFTokenMint, NFTokenMintFlags, convertStringToHex } from 'xrpl';
import pinataSDK from '@pinata/sdk';
import { XummSdk } from 'xumm-sdk';
import fs from 'fs';
import dotenv from 'dotenv';
import cors from 'cors';

import PDFDocument from 'pdfkit';

dotenv.config();

const app = express();
const PORT = 3000;

// Middleware
app.use(express.json());
app.use(cors());

const upload = multer({ dest: 'uploads/' });

// Clients
let stripeClient: Stripe | null = null;
const getStripe = () => {
    if (!stripeClient) {
        if (!process.env.STRIPE_SECRET_KEY) {
            console.error('STRIPE_SECRET_KEY is missing');
            return null;
        }
        stripeClient = new Stripe(process.env.STRIPE_SECRET_KEY);
    }
    return stripeClient;
};

const pinata = process.env.PINATA_API_KEY && process.env.PINATA_SECRET_KEY 
    ? new pinataSDK(process.env.PINATA_API_KEY, process.env.PINATA_SECRET_KEY)
    : null;

const xumm = process.env.XUMM_API_KEY && process.env.XUMM_API_SECRET
    ? new XummSdk(process.env.XUMM_API_KEY, process.env.XUMM_API_SECRET)
    : null;

// XRPL Counter (In real app, fetch from DB or chain)
let mintCount = 0;
const MAX_MINTS = 1000;
const PRICE_USD = 1999; // $19.99 in cents

// --- API Routes ---

// 0. Config Info
app.get('/api/config', (req, res) => {
    res.json({
        network: process.env.XRPL_NETWORK || 'testnet',
        xummEnabled: !!xumm,
        pinataEnabled: !!pinata
    });
});

// 1. Get Mint Progress
app.get('/api/progress', (req, res) => {
    res.json({ count: mintCount, max: MAX_MINTS });
});

// 2. Stripe Checkout Session
app.post('/api/create-checkout', async (req, res) => {
    const { zipcode, route, imageName } = req.body;
    const stripe = getStripe();
    if (!stripe) return res.status(500).json({ error: 'Stripe not configured' });

    try {
        const session = await stripe.checkout.sessions.create({
            payment_method_types: ['card'],
            line_items: [
                {
                    price_data: {
                        currency: 'usd',
                        product_data: {
                            name: `Digital Stamp NFT - Zip: ${zipcode}, Route: ${route}`,
                            description: `Unique digital stamp for mail carrier community. Minting #${mintCount + 1} of 1000. $19.99 per mint.`,
                        },
                        unit_amount: PRICE_USD,
                    },
                    quantity: 1,
                },
            ],
            mode: 'payment',
            success_url: `${process.env.APP_URL}/success?session_id={CHECKOUT_SESSION_ID}`,
            cancel_url: `${process.env.APP_URL}/cancel`,
            metadata: {
                zipcode,
                route,
                imageName
            }
        });
        res.json({ id: session.id, url: session.url });
    } catch (error: any) {
        console.error('Checkout error:', error);
        res.status(500).json({ error: error.message });
    }
});

// 2.6 Check XUMM Payload Status
app.get('/api/mint-status/:uuid', async (req, res) => {
    if (!xumm) return res.status(500).json({ error: 'XUMM not configured' });
    try {
        const payload = await xumm.payload.get(req.params.uuid);
        res.json({
            resolved: payload?.meta.resolved,
            signed: payload?.meta.signed,
            txid: payload?.response.txid
        });
    } catch (error: any) {
        res.status(500).json({ error: error.message });
    }
});

// 3. Image Upload
app.post('/api/upload', upload.single('image'), (req, res) => {
    if (!req.file) return res.status(400).send('No file uploaded.');
    // In a real app we'd keep track of this temp file associated with a session or wait for webhook
    res.json({ filename: req.file.filename });
});

// 4. XUMM Minting Payload
async function createXummMintPayload(metadata: { zipcode: string, route: string, imagePath: string }) {
    if (!xumm) throw new Error('XUMM SDK not configured in environment variables (XUMM_API_KEY, XUMM_API_SECRET).');
    
    // 1. Upload to IPFS first
    let tokenURI = "ipfs://placeholder";
    if (pinata) {
        const readableStreamForFile = fs.createReadStream(metadata.imagePath);
        const options = {
            pinataMetadata: {
                name: `PathLedger-Stamp-${mintCount + 1}`,
                keyvalues: { zipcode: metadata.zipcode, route: metadata.route } as any
            }
        };
        const result = await pinata.pinFileToIPFS(readableStreamForFile, options);
        tokenURI = `ipfs://${result.IpfsHash}`;
    }

    // 2. Create XUMM NFTokenMint Payload
    const transaction: NFTokenMint = {
        TransactionType: "NFTokenMint",
        Account: "rHb9CJAQuHDB3sr89w9FjS38B2rDW477vi", // Placeholder - XUMM will replace with user's address
        URI: convertStringToHex(tokenURI),
        Flags: NFTokenMintFlags.tfTransferable,
        TransferFee: 7000, 
        NFTokenTaxon: 0
    };

    try {
        const payload = await xumm.payload.create({
            txjson: transaction,
            options: {
                return_url: {
                    app: `${process.env.APP_URL}?mint_success=true`,
                    web: `${process.env.APP_URL}?mint_success=true`
                }
            }
        } as any);

        if (!payload) throw new Error("Failed to create XUMM payload");
        
        return {
            uuid: payload.uuid,
            qrCode: payload.refs.qr_png,
            nextUrl: payload.next.always
        };
    } catch (error: any) {
        if (error.reason === 'API_KEY_REVOKED') {
            throw new Error("XUMM AUTH ERROR: Your Xumm API Key has been revoked or is invalid. Please create a new API Key at https://apps.xaman.dev and update your XUMM_API_KEY and XUMM_API_SECRET in AI Studio Secrets.");
        }
        throw error;
    }
}

// 4.5 Internal Minting (for automated webhooks when using a Master Wallet)
async function mintStamp(metadata: { zipcode: string, route: string, imagePath: string }) {
    if (!process.env.XRPL_SEED) throw new Error('XRPL_SEED missing. Automated minting requires a master wallet seed.');
    
    const client = new Client(process.env.XRPL_NETWORK === 'mainnet' ? "wss://xrplcluster.com" : "wss://s.altnet.rippletest.net:51233");
    await client.connect();

    try {
        let wallet: Wallet;
        const seed = process.env.XRPL_SEED.trim();

        try {
            if (seed.includes(' ')) {
                wallet = Wallet.fromMnemonic(seed);
            } else if (seed.length === 64 && /^[0-9A-Fa-f]+$/.test(seed)) {
                wallet = Wallet.fromEntropy(Uint8Array.from(Buffer.from(seed, 'hex'))); 
            } else {
                wallet = Wallet.fromSeed(seed);
            }
        } catch (e: any) {
            throw new Error(`Invalid XRPL_SEED: ${e.message}. Use a family seed (starts with 's') or mnemonic.`);
        }

        mintCount++;
        
        // 1. Upload to IPFS
        let tokenURI = "ipfs://placeholder";
        if (pinata) {
            const readableStreamForFile = fs.createReadStream(metadata.imagePath);
            const options = {
                pinataMetadata: {
                    name: `PathLedger-Stamp-${mintCount}`,
                    keyvalues: { zipcode: metadata.zipcode, route: metadata.route } as any
                }
            };
            const result = await pinata.pinFileToIPFS(readableStreamForFile, options);
            tokenURI = `ipfs://${result.IpfsHash}`;
        }

        // 2. Mint NFT
        const transaction: NFTokenMint = {
            TransactionType: "NFTokenMint",
            Account: wallet.address,
            URI: convertStringToHex(tokenURI),
            Flags: NFTokenMintFlags.tfTransferable,
            TransferFee: 7000, 
            NFTokenTaxon: 0
        };

        const response = await client.submitAndWait(transaction, { wallet });
        return { success: true, hash: response.result.hash, serial: mintCount };
    } finally {
        await client.disconnect();
    }
}

// 5. Stripe Webhook (Handle successful payment)
app.post('/api/webhook', express.raw({ type: 'application/json' }), async (req, res) => {
    const stripe = getStripe();
    const sig = req.headers['stripe-signature'];
    const endpointSecret = process.env.STRIPE_WEBHOOK_SECRET;

    let event;

    try {
        if (!stripe || !sig || !endpointSecret) throw new Error('Missing webhook requirements');
        event = stripe.webhooks.constructEvent(req.body, sig, endpointSecret);
    } catch (err: any) {
        console.error('Webhook signature verification failed:', err.message);
        return res.status(400).send(`Webhook Error: ${err.message}`);
    }

    if (event.type === 'checkout.session.completed') {
        const session = event.data.object as Stripe.Checkout.Session;
        const { zipcode, route, imageName } = session.metadata || {};

        if (zipcode && route && imageName) {
            const imagePath = path.join(process.cwd(), 'uploads', imageName);
            console.log('Payment successful! Initializing mint for:', session.metadata);
            
            // Trigger minting asynchronously so we don't block the webhook response
            mintStamp({ zipcode, route, imagePath })
                .then(result => {
                    console.log('Successfully minted stamp:', result);
                    // Optionally delete the local file after successful IPFS upload
                    if (fs.existsSync(imagePath)) fs.unlinkSync(imagePath);
                })
                .catch(err => {
                    console.error('Async minting failed:', err);
                });
        }
    }

    res.json({ received: true });
});

// 6. Generate Business Documents PDF
app.get('/api/generate-reports', (req, res) => {
    console.log('Generating report PDF...');
    try {
        const doc = new PDFDocument();
        const filename = 'Digital_Stamp_Protocol_Business_Reports.pdf';

        res.setHeader('Content-disposition', `attachment; filename="${filename}"`);
        res.setHeader('Content-type', 'application/pdf');

        doc.pipe(res);

        // Header Logo
        const logoPath = path.join(process.cwd(), 'pathledger_logo.png');
        try {
            if (fs.existsSync(logoPath) && fs.statSync(logoPath).size > 0) {
                doc.image(logoPath, 50, 45, { width: 120 });
            } else {
                doc.fontSize(24).fillColor('#4f46e5').text('PATHLEDGER', 50, 50, { bold: true });
            }
        } catch (e) {
            doc.fontSize(24).fillColor('#4f46e5').text('PATHLEDGER', 50, 50, { bold: true });
        }
        
        doc.fillColor('black');
        
        // Title
        doc.fontSize(20).text('Digital Stamp Protocol', 300, 55, { align: 'right' });
        doc.fontSize(10).text('INVESTOR RELATIONS / ACQUIRE LISTING VERSION', 300, 75, { align: 'right', color: 'gray' });
        
        doc.moveDown(3);
        doc.moveTo(50, 100).lineTo(550, 100).stroke();
        doc.moveDown(2);

        // Section: CIM
        doc.fontSize(18).text('1. Confidential Information Memorandum (CIM)', { underline: true });
        doc.moveDown();
        doc.fontSize(12).text('The Digital Stamp Protocol is a high-utility NFT ecosystem built on the XRP Ledger. It targets the courier and logistics segment, providing a unique "Digital Stamp" that serves as proof-of-work and community identity for mail carriers and delivery personnel.');
        doc.moveDown();
        doc.text('Investment Highlights:');
        doc.list([
            'Low-cost, high-speed minting on XRPL.',
            'Direct utility for delivery proofing and route-based collectibles.',
            'Interoperable with the Xaman (XUMM) wallet for mobile usage.',
            'Established pricing model ($19.99 per mint) with low overhead.'
        ]);
        doc.moveDown(2);

        // Section: Tech Stack
        doc.fontSize(18).text('2. Tech Stack Report', { underline: true });
        doc.moveDown();
        doc.fontSize(12).text('The application is built using modern, production-grade technology to ensure scalability, security, and exceptional user experience.');
        doc.moveDown();
        doc.text('Key Technologies:');
        doc.list([
            'Frontend: React 18 with Vite - Ultra-fast, component-based UI.',
            'Styling: Tailwind CSS v4 - Utility-first design with modern variables.',
            'Backend: Node.js (Express) - Robust, event-driven server architecture.',
            'Blockchain (L1): XRPL (XRP Ledger) - High-throughput, low-fee NFT support.',
            'Wallet Integration: Xaman (XUMM) SDK - Browser-to-Mobile secure authentication.',
            'Storage: IPFS (via Pinata) - Decentralized, immutable asset storage.',
            'Payments: Stripe - Enterprise-grade fiat on-ramp.',
            'Animations: Motion (framer-motion) - Fluid user transitions.'
        ]);
        doc.moveDown(2);

        // Section: P&L Report
        doc.fontSize(18).text('3. Profit & Loss (P&L) Projections', { underline: true });
        doc.moveDown();
        doc.text('Financial Summary (Single Collection Unit):');
        doc.moveDown();
        
        const tableTop = doc.y;
        doc.text('Category', 50, tableTop, { bold: true });
        doc.text('Details', 250, tableTop, { bold: true });
        doc.text('Amount (USD)', 450, tableTop, { bold: true });
        
        doc.moveDown();
        doc.text('Gross Revenue', 50, doc.y);
        doc.text('1000 Mints @ $19.99', 250, doc.y);
        doc.text('$19,990.00', 450, doc.y);
        
        doc.moveDown();
        doc.text('Stripe Fees', 50, doc.y);
        doc.text('2.9% + $0.30/txn', 250, doc.y);
        doc.text('($879.71)', 450, doc.y);

        doc.moveDown();
        doc.text('IPFS Storage', 50, doc.y);
        doc.text('Pinata Monthly', 250, doc.y);
        doc.text('($20.00)', 450, doc.y);

        doc.moveDown();
        doc.text('Hosting', 50, doc.y);
        doc.text('Cloud Infrastructure', 250, doc.y);
        doc.text('($5.00)', 450, doc.y);

        doc.moveDown();
        doc.moveTo(50, doc.y).lineTo(550, doc.y).stroke();
        doc.moveDown();
        
        doc.fontSize(14).text('Net Profit (Projected)', 50, doc.y, { bold: true });
        doc.text('', 250, doc.y);
        doc.text('$19,085.29', 450, doc.y, { bold: true });

        doc.moveDown(3);
        doc.fontSize(10).text('Generated by PathLedger Automated Business Analyst Tool', { align: 'center', color: 'gray' });

        doc.end();
        console.log('Report PDF generated successfully.');
    } catch (err: any) {
        console.error('PDF Generation Error:', err);
        res.status(500).send(`Internal Server Error: ${err.message}`);
    }
});

// --- POLL API ---

// Store poll responses in a JSON file
const POLL_FILE = path.join(process.cwd(), 'poll_responses.json');

function loadPollResponses(): any[] {
    try {
        if (fs.existsSync(POLL_FILE)) {
            return JSON.parse(fs.readFileSync(POLL_FILE, 'utf-8'));
        }
    } catch (e) {
        console.error('Error loading poll responses:', e);
    }
    return [];
}

function savePollResponses(responses: any[]) {
    fs.writeFileSync(POLL_FILE, JSON.stringify(responses, null, 2));
}

// Submit a poll response
app.post('/api/poll', (req, res) => {
    try {
        const { q1, q2, q3, q4, q5, feedback } = req.body;
        if (!q1 || !q2 || !q3 || !q4 || !q5) {
            return res.status(400).json({ error: 'Please answer all required questions.' });
        }
        const response = {
            q1, q2, q3, q4, q5,
            feedback: feedback || '',
            timestamp: new Date().toISOString(),
            ip: req.headers['x-forwarded-for'] || req.socket.remoteAddress
        };
        const responses = loadPollResponses();
        responses.push(response);
        savePollResponses(responses);
        res.json({ success: true, total: responses.length });
    } catch (error: any) {
        console.error('Poll submission error:', error);
        res.status(500).json({ error: 'Failed to save response.' });
    }
});

// View poll results (admin)
app.get('/api/poll/results', (req, res) => {
    const responses = loadPollResponses();
    const total = responses.length;
    if (total === 0) return res.json({ total: 0, message: 'No responses yet.' });

    // Aggregate results
    const aggregate = (key: string) => {
        const counts: Record<string, number> = {};
        responses.forEach(r => {
            const val = r[key] || 'no-answer';
            counts[val] = (counts[val] || 0) + 1;
        });
        return counts;
    };

    res.json({
        total,
        q1_years_of_service: aggregate('q1'),
        q2_feel_recognized: aggregate('q2'),
        q3_blockchain_record_value: aggregate('q3'),
        q4_most_important_benefit: aggregate('q4'),
        q5_would_you_buy: aggregate('q5'),
        feedback: responses.filter(r => r.feedback).map(r => ({ feedback: r.feedback, timestamp: r.timestamp }))
    });
});

// Vite middleware
async function startServer() {
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

startServer();
