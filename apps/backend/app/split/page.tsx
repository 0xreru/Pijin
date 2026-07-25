export default function SplitSimulatorPage() {
  return (
    <div className="min-h-screen bg-[#111111] flex flex-col items-center justify-center py-6 overflow-hidden">
      <div className="text-center mb-6">
        <h1 className="text-3xl font-black text-white tracking-tight">Pijin P2P Simulation</h1>
        <p className="text-neutral-400 font-medium mt-1">Live Offline & Online Transfer Engine</p>
      </div>
      
      <div 
        className="flex flex-row items-center justify-center gap-8 md:gap-16 w-full"
        style={{ transform: 'scale(min(1, min(100vw / 1000, 100vh / 1050)))', transformOrigin: 'top center' }}
      >
        {/* SENDER PHONE */}
        <div className="flex flex-col items-center">
          <p className="text-neutral-500 font-bold uppercase tracking-widest mb-4">Sender</p>
          <iframe 
            src="/demo?role=sender" 
            className="w-[418px] h-[872px] border-none rounded-[3rem] shadow-2xl bg-black overflow-hidden"
            scrolling="no"
          />
        </div>

        {/* RECEIVER PHONE */}
        <div className="flex flex-col items-center">
          <p className="text-neutral-500 font-bold uppercase tracking-widest mb-4">Receiver</p>
          <iframe 
            src="/demo?role=receiver" 
            className="w-[418px] h-[872px] border-none rounded-[3rem] shadow-2xl bg-black overflow-hidden"
            scrolling="no"
          />
        </div>
      </div>
    </div>
  );
}
