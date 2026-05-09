# PathLedger App - Build & Deploy Instructions

## Overview
PathLedger is a full-stack React + Express app for minting Digital Stamp NFTs on the XRP Ledger. It has:
- A React 19 frontend with Tailwind CSS v4, Motion (framer-motion), and Lucide icons
- An Express backend (server.ts) with Stripe payments, XRPL minting, XUMM wallet integration, Pinata/IPFS uploads, and PDF report generation
- Domain: pathledger.org

## What to Build & Deploy
Build this as a complete working web application and deploy it to a public URL. The domain is pathledger.org.

## Project Files
All source files are in `/home/ubuntu/pathledger_project/`:
- `src/App.tsx` - Main React component (full minting UI)
- `src/main.tsx` - React entry point
- `src/index.css` - Tailwind CSS import
- `server.ts` - Express backend with all API routes
- `index.html` - HTML template
- `package.json` - Dependencies and scripts
- `vite.config.ts` - Vite configuration
- `tsconfig.json` - TypeScript config
- `.env.example` - Environment variable template
- `pathledger_logo.png` - Logo file (currently empty/0 bytes - generate a proper logo)
- `metadata.json` - App metadata

## Key Technical Details
- The app uses `tsx server.ts` for dev mode which runs Express + Vite middleware
- For production: `vite build` creates the dist folder, then Express serves static files from dist
- The server runs on port 3000
- API routes: /api/config, /api/progress, /api/create-checkout, /api/upload, /api/mint-status/:uuid, /api/webhook, /api/generate-reports
- The frontend calls these API routes

## Important Notes
- The logo file (pathledger_logo.png) is 0 bytes/empty - please generate a proper PathLedger logo
- Update index.html title from "My Google AI Studio App" to "PathLedger - Digital Stamp Protocol"
- Make sure all dependencies install and the app builds successfully
- Deploy the working app to a public URL
- The app should work even without API keys configured (it gracefully handles missing configs)
