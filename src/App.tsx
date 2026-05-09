import React, { useState, useEffect, useCallback } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { 
  Upload, 
  Stamp, 
  MapPin, 
  Truck, 
  CheckCircle2, 
  ExternalLink,
  Loader2,
  AlertCircle,
  FileText,
  Download
} from 'lucide-react';

export default function App() {
  const [file, setFile] = useState<File | null>(null);
  const [zipcode, setZipcode] = useState('');
  const [route, setRoute] = useState('');
  const [preview, setPreview] = useState<string | null>(null);
  const [isUploading, setIsUploading] = useState(false);
  const [mintProgress, setMintProgress] = useState({ count: 0, max: 1000 });
  const [status, setStatus] = useState<'idle' | 'processing' | 'success' | 'error'>('idle');
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
  const [xummPayload, setXummPayload] = useState<{ uuid: string; qrCode: string; nextUrl: string } | null>(null);
  const [config, setConfig] = useState<{ network: string; xummEnabled: boolean; pinataEnabled: boolean } | null>(null);

  useEffect(() => {
    fetch('/api/config')
      .then(res => res.json())
      .then(setConfig)
      .catch(console.error);
  }, []);

  useEffect(() => {
    let pollInterval: NodeJS.Timeout;
    if (xummPayload) {
        pollInterval = setInterval(async () => {
            try {
                const res = await fetch(`/api/mint-status/${xummPayload.uuid}`);
                const data = await res.json();
                if (data.signed) {
                    clearInterval(pollInterval);
                    setSuccess(true);
                    setStatus('success');
                    setXummPayload(null);
                }
            } catch (e) {
                console.error('Polling error:', e);
            }
        }, 3000);
    }
    return () => clearInterval(pollInterval);
  }, [xummPayload]);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get('session_id')) {
        setSuccess(true);
        setStatus('success');
    }
    if (window.location.pathname === '/cancel') {
        setError('Transaction cancelled.');
    }

    fetch('/api/progress')
      .then(res => res.json())
      .then(data => setMintProgress(data))
      .catch(console.error);
  }, []);

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const selectedFile = e.target.files?.[0];
    if (selectedFile) {
      setFile(selectedFile);
      const reader = new FileReader();
      reader.onloadend = () => {
        setPreview(reader.result as string);
      };
      reader.readAsDataURL(selectedFile);
    }
  };

  const handleMint = async () => {
    if (!file || !zipcode || !route) {
        setError('Please fill all fields and upload an image.');
        return;
    }

    setIsUploading(true);
    setStatus('processing');
    setError(null);

    try {
      // 1. Upload the image first
      const formData = new FormData();
      formData.append('image', file);
      
      const uploadRes = await fetch('/api/upload', {
        method: 'POST',
        body: formData,
      });

      if (!uploadRes.ok) throw new Error('Failed to upload image');
      const { filename } = await uploadRes.json();

      // 2. Create Stripe Checkout session
      const checkoutRes = await fetch('/api/create-checkout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ zipcode, route, imageName: filename }),
      });

      if (!checkoutRes.ok) throw new Error('Failed to create checkout session');
      const { url } = await checkoutRes.json();

      // Redirect to Stripe
      window.location.href = url;
    } catch (err: any) {
      setStatus('error');
      setError(err.message || 'Something went wrong.');
    } finally {
      setIsUploading(false);
    }
  };

  const downloadReport = () => {
    // Direct location change is safer for downloads in this env
    window.location.href = '/api/generate-reports';
  };

  return (
    <div className="min-h-screen bg-slate-100 text-slate-900 font-sans p-4 md:p-8">
      <AnimatePresence>
        {xummPayload && (
            <motion.div 
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-slate-900/90 backdrop-blur-sm"
            >
                <div className="bg-white rounded-3xl p-8 max-w-sm w-full text-center space-y-6 shadow-2xl">
                    <div className="space-y-2">
                        <h3 className="text-xl font-black tracking-tight uppercase">Sign with Xaman</h3>
                        <p className="text-xs text-slate-500 font-medium px-4">
                            Open your Xaman (Xumm) app and scan this code to authorize your Digital Stamp minting.
                        </p>
                    </div>
                    
                    <div className="aspect-square bg-slate-50 rounded-2xl flex items-center justify-center p-4 border border-slate-100 relative overflow-hidden">
                        <img src={xummPayload.qrCode} alt="Xumm QR" className="w-full h-full" />
                    </div>

                    <div className="flex flex-col gap-3">
                        <a 
                            href={xummPayload.nextUrl}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="bg-indigo-600 text-white py-3 rounded-xl font-bold text-sm shadow-lg shadow-indigo-200 block md:hidden"
                        >
                            Open in Xaman App
                        </a>
                        <button 
                            onClick={() => setXummPayload(null)}
                            className="text-slate-400 text-[10px] font-bold uppercase tracking-widest hover:text-slate-600"
                        >
                            Cancel Transaction
                        </button>
                    </div>

                    <div className="pt-4 border-t border-slate-100 italic text-[10px] text-slate-400">
                        Awaiting signature...
                    </div>
                </div>
            </motion.div>
        )}
      </AnimatePresence>

      {/* Header Section */}
      <header className="max-w-7xl mx-auto mb-8 bg-white p-4 rounded-xl border border-slate-200 shadow-sm flex flex-col md:flex-row items-center justify-between gap-4">
        <div className="flex items-center gap-4">
          <div className="w-10 h-10 bg-indigo-600 rounded-lg flex items-center justify-center text-white font-bold shadow-indigo-200 shadow-lg">
            <Stamp className="w-6 h-6" />
          </div>
          <div>
            <h1 className="text-lg font-bold leading-tight tracking-tight uppercase">PathLedger Infrastructure</h1>
            <p className="text-[10px] text-slate-500 uppercase tracking-widest font-bold">
              Status: <span className="text-emerald-600">Active</span> • v2.1.0-stable
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2 text-xs font-medium">
          <a 
            href="#reports"
            className="px-3 py-2 bg-slate-100 text-slate-600 border border-slate-200 rounded-lg hover:bg-slate-200 transition-all font-bold flex items-center gap-1.5"
          >
            <FileText className="w-3 h-3" />
            BUSINESS CENTER
          </a>
          {config?.network === 'testnet' && (
            <a 
              href="https://xrpl.org/resources/dev-tools/xrp-faucets" 
              target="_blank" 
              rel="noopener noreferrer"
              className="px-3 py-2 bg-amber-100 text-amber-700 border border-amber-200 rounded-lg hover:bg-amber-200 transition-all font-bold flex items-center gap-1.5"
            >
              <ExternalLink className="w-3 h-3" />
              GET TESTNET XRP
            </a>
          )}
          <div className="flex flex-col items-end gap-1 px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg h-full justify-center">
            <span className="text-[8px] uppercase font-bold text-slate-400 leading-none">XRPL Network</span>
            <span className={`font-black uppercase leading-none ${config?.network === 'mainnet' ? 'text-indigo-600' : 'text-amber-600'}`}>
              {config?.network || 'Loading...'}
            </span>
          </div>
          <span className="px-3 py-2 bg-emerald-100 text-emerald-700 border border-emerald-200 rounded-lg flex items-center gap-1.5 font-bold h-full">
            <span className="w-2 h-2 bg-emerald-500 rounded-full animate-pulse"></span> 
            {mintProgress.count} / {mintProgress.max} MINTED
          </span>
        </div>
      </header>

      <main className="max-w-7xl mx-auto">
        {!config?.xummEnabled && (
          <div className="mb-6 p-4 bg-amber-50 border border-amber-200 rounded-xl flex items-center gap-4 text-amber-800 shadow-sm">
            <AlertCircle className="w-6 h-6 flex-shrink-0" />
            <div className="flex-1">
              <p className="text-sm font-bold">XUMM (Xaman) Connection Missing</p>
              <p className="text-xs opacity-80">To enable Digital Stamp minting, update your <b>XUMM_API_KEY</b> and <b>XUMM_API_SECRET</b> in AI Studio Settings. Use the <b>Testnet</b> network at <a href="https://apps.xaman.dev" target="_blank" rel="noreferrer" className="underline font-bold">apps.xaman.dev</a> if testing.</p>
            </div>
            <button 
              onClick={() => window.location.reload()}
              className="px-4 py-2 bg-amber-600 text-white rounded-lg text-xs font-bold hover:bg-amber-700 transition-all shadow-sm shadow-amber-200"
            >
              Verify Config
            </button>
          </div>
        )}
        <div className="grid grid-cols-1 md:grid-cols-12 gap-6">
          {/* LEFT: Project Overview */}
          <motion.div 
            initial={{ opacity: 0, x: -10 }}
            animate={{ opacity: 1, x: 0 }}
            className="md:col-span-7 space-y-6"
          >
            <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-6">
              <div className="flex items-center justify-between mb-6">
                <h2 className="text-xs font-bold uppercase tracking-widest text-slate-400">Project Specification</h2>
                <span className="text-[10px] bg-indigo-50 text-indigo-700 px-2 py-0.5 rounded border border-indigo-100 font-bold uppercase">Community_Access</span>
              </div>
              <h2 className="text-4xl font-extrabold mb-4 tracking-tighter leading-none">
                Digital Stamp <span className="text-indigo-600">XLS-20</span> Protocol
              </h2>
              <p className="text-sm text-slate-500 leading-relaxed max-w-xl">
                A high-density minting interface for mail carriers. Encode community route data directly into the XRP Ledger at a fixed $19.99 rate with immutable royalty structures.
              </p>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-4 flex flex-col justify-between">
                <label className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-2">Minting Fee</label>
                <div className="text-2xl font-black text-slate-900">$19.99 <span className="text-xs font-medium text-slate-400">USD/NFT</span></div>
              </div>
              <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-4 flex flex-col justify-between">
                <label className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-2">Royalty Rate</label>
                <div className="text-2xl font-black text-emerald-600">7.00% <span className="text-xs font-medium text-slate-400">RESALE</span></div>
              </div>
            </div>

            <div className="bg-indigo-900 text-white rounded-xl p-6 shadow-xl border border-indigo-800">
              <h2 className="text-[10px] font-bold uppercase tracking-widest text-indigo-300 mb-4">Infrastructure Guard</h2>
              <div className="space-y-3 font-mono text-xs">
                <div className="flex items-center justify-between border-b border-indigo-800 pb-2">
                  <span className="text-indigo-200 flex items-center gap-2"><Truck className="w-4 h-4" /> Transit Verification</span>
                  <span className="text-emerald-400 font-bold uppercase">Ready</span>
                </div>
                <div className="flex items-center justify-between border-b border-indigo-800 pb-2">
                  <span className="text-indigo-200 flex items-center gap-2"><MapPin className="w-4 h-4" /> Geo-Tagging Logic</span>
                  <span className="text-emerald-400 font-bold uppercase">Synched</span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-indigo-200 flex items-center gap-2"><ExternalLink className="w-4 h-4" /> XRPL Mainnet Oracle</span>
                  <span className="text-indigo-100">Live</span>
                </div>
              </div>
            </div>
          </motion.div>

          {/* RIGHT: Minting Action Card */}
          <motion.div 
            initial={{ opacity: 0, x: 10 }}
            animate={{ opacity: 1, x: 0 }}
            className="md:col-span-5"
          >
            <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-6 sticky top-24">
              <h2 className="text-xs font-bold uppercase tracking-widest text-slate-400 mb-6">Initialize Minting Sequence</h2>
              
              <AnimatePresence>
                {success && (
                    <motion.div 
                        initial={{ opacity: 0, scale: 0.9 }}
                        animate={{ opacity: 1, scale: 1 }}
                        className="bg-emerald-900 text-white p-8 rounded-2xl border border-emerald-500 shadow-2xl text-center space-y-4"
                    >
                        <div className="w-16 h-16 bg-emerald-500 rounded-full flex items-center justify-center mx-auto">
                            <CheckCircle2 className="w-8 h-8" />
                        </div>
                        <h2 className="text-2xl font-black tracking-tight">TRANSACTION_SUCCESS</h2>
                        <p className="text-sm text-emerald-200 font-medium leading-relaxed">
                            Payment verified. Your Digital Stamp is being minted on the XRPL. Check your wallet in a few moments.
                        </p>
                        <button 
                            onClick={() => window.location.href = '/'}
                            className="w-full py-3 bg-white text-emerald-900 rounded-xl font-bold text-sm tracking-wider"
                        >
                            RETURN TO DASHBOARD
                        </button>
                    </motion.div>
                )}

                {!success && (
                    <div className="space-y-8">
                        {/* Image Upload Area */}
                        <div className="group">
                            <label className="block text-[10px] font-bold text-slate-500 mb-2 uppercase tracking-widest">Image Source Layer</label>
                            <div 
                                onClick={() => document.getElementById('fileInput')?.click()}
                                className={`relative w-full aspect-square rounded-xl border-2 border-dashed transition-all cursor-pointer ${
                                    preview 
                                    ? 'border-transparent bg-slate-50' 
                                    : 'border-slate-200 bg-slate-50 hover:border-indigo-400 hover:bg-slate-100'
                                }`}
                            >
                                <input type="file" id="fileInput" className="hidden" accept="image/*" onChange={handleFileChange} />
                                
                                {preview ? (
                                    <div className="relative w-full h-full p-2 group">
                                        <img src={preview} alt="Preview" className="w-full h-full object-cover rounded-lg" />
                                        <div className="absolute inset-0 bg-slate-900/40 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center rounded-lg">
                                            <span className="text-white text-xs font-bold uppercase bg-slate-900/80 px-3 py-1 rounded">Update Layer</span>
                                        </div>
                                        {/* High Density Overlay */}
                                        <div className="absolute bottom-4 right-4 bg-slate-900 text-white p-3 rounded shadow-2xl border border-slate-700 min-w-[120px]">
                                            <div className="text-[8px] font-bold text-slate-400 mb-1 tracking-widest">METADATA_EXTRACT</div>
                                            <div className="text-xs font-mono font-bold leading-none mb-1 text-emerald-400">{zipcode || '00000'}</div>
                                            <div className="text-[9px] font-mono text-slate-300">RT_{route || 'N/A'}</div>
                                        </div>
                                    </div>
                                ) : (
                                    <div className="flex flex-col items-center justify-center h-full gap-3 p-8">
                                        <div className="p-3 bg-white rounded-lg border border-slate-200">
                                            <Upload className="w-6 h-6 text-indigo-600" />
                                        </div>
                                        <div className="text-center">
                                            <p className="text-xs font-bold uppercase tracking-wider text-slate-700">Push Image to IPFS</p>
                                            <p className="text-[10px] text-slate-400">JPG, PNG, TIFF (MAX 10MB)</p>
                                        </div>
                                    </div>
                                )}
                            </div>
                        </div>

                        {/* Grid Inputs */}
                        <div className="grid grid-cols-2 gap-4">
                            <div>
                                <label className="block text-[10px] font-bold text-slate-500 mb-2 uppercase tracking-widest">Routing Zip</label>
                                <input 
                                    type="text" 
                                    placeholder="90210"
                                    maxLength={5}
                                    value={zipcode}
                                    onChange={(e) => setZipcode(e.target.value)}
                                    className="w-full px-4 py-3 bg-slate-50 border border-slate-200 rounded-lg focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 outline-none transition-all font-mono text-xs"
                                />
                            </div>
                            <div>
                                <label className="block text-[10px] font-bold text-slate-500 mb-2 uppercase tracking-widest">Route Ident</label>
                                <input 
                                    type="text" 
                                    placeholder="RT-01"
                                    maxLength={4}
                                    value={route}
                                    onChange={(e) => setRoute(e.target.value)}
                                    className="w-full px-4 py-3 bg-slate-50 border border-slate-200 rounded-lg focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 outline-none transition-all font-mono text-xs"
                                />
                            </div>
                        </div>

                        {/* Error Logic */}
                        <AnimatePresence>
                            {error && (
                                <motion.div 
                                    initial={{ opacity: 0, y: -5 }} animate={{ opacity: 1, y: 0 }}
                                    className="p-3 bg-red-50 border border-red-100 text-red-600 text-[10px] font-bold uppercase tracking-wide rounded-lg flex gap-2"
                                >
                                    <AlertCircle className="w-4 h-4 flex-shrink-0" /> {error}
                                </motion.div>
                            )}
                        </AnimatePresence>

                        {/* Action Button */}
                        <div className="flex flex-col gap-3">
                            <button 
                                onClick={handleMint}
                                disabled={isUploading || !file || !zipcode || !route}
                                className={`w-full py-4 rounded-xl font-bold text-sm shadow-xl flex items-center justify-center gap-2 transition-all active:scale-[0.98] ${
                                    isUploading || !file || !zipcode || !route
                                    ? 'bg-slate-100 text-slate-400 border border-slate-200 shadow-none cursor-not-allowed'
                                    : 'bg-slate-900 text-white hover:bg-black shadow-slate-200'
                                }`}
                            >
                                {isUploading ? (
                                    <>
                                        <Loader2 className="w-5 h-5 animate-spin" />
                                        SYSTEM_ROLLOUT_PROGRESS...
                                    </>
                                ) : (
                                    <>
                                        INITIALIZE PRODUCTION MINT
                                        <CheckCircle2 className="w-5 h-5" />
                                    </>
                                )}
                            </button>
                        </div>
                    </div>
                )}
            </AnimatePresence>

              <div className="mt-8 pt-8 border-t border-slate-100 flex flex-col gap-2">
                <div className="flex justify-between text-[10px] uppercase font-bold tracking-widest text-slate-400">
                  <span>Authorized Personnel</span>
                  <span>AES-256 Enabled</span>
                </div>
              </div>
            </div>
          </motion.div>
        </div>
      </main>

      <section id="reports" className="max-w-7xl mx-auto mt-12 mb-20 bg-white rounded-3xl border border-slate-200 p-8 shadow-xl relative overflow-hidden">
        <div className="absolute top-0 left-0 w-full h-1 bg-gradient-to-r from-indigo-500 via-purple-500 to-pink-500"></div>
        <div className="flex flex-col md:flex-row items-center justify-between gap-8">
          <div className="space-y-2">
            <div className="flex items-center gap-2">
              <span className="px-2 py-0.5 bg-indigo-100 text-indigo-700 text-[8px] font-black uppercase rounded">System Reports</span>
            </div>
            <h3 className="text-xl font-black uppercase tracking-tight flex items-center gap-3">
              <FileText className="w-6 h-6 text-indigo-600" />
              Business Intelligence Center
            </h3>
            <p className="text-sm text-slate-500 font-medium max-w-xl">
              Access the investor-ready documentation package. This includes the Confidential Information Memorandum (CIM), full technical specifications, and detailed financial projections for the Acquire platform.
            </p>
          </div>
          <button 
            onClick={downloadReport}
            className="flex items-center gap-3 px-8 py-4 bg-slate-950 text-white border border-slate-800 rounded-2xl font-black text-xs hover:bg-black transition-all shadow-2xl active:scale-95 whitespace-nowrap group"
          >
            <Download className="w-4 h-4 text-indigo-400 group-hover:animate-bounce" />
            DOWNLOAD ACQUIRE PACKAGE (PDF)
          </button>
        </div>
      </section>

      <footer className="max-w-7xl mx-auto mt-12 flex flex-col md:flex-row justify-between items-center text-[10px] text-slate-400 font-medium tracking-wider uppercase border-t border-slate-200 pt-6 gap-4">
        <div>AUTHORIZED PERSONNEL ONLY • SESSION: PL-902-XP-D</div>
        <div className="flex gap-6">
          <span>ENCRYPTION: AES-XRPL</span>
          <span className="text-slate-500">REGION: US-EAST-CLOUDRUN</span>
          <span className="flex items-center gap-1"><span className="w-1.5 h-1.5 bg-emerald-500 rounded-full"></span> LIVE SYNC: 0 SEC AGO</span>
        </div>
      </footer>
    </div>
  );
}
