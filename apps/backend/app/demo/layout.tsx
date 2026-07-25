import React from 'react';
import GhostProvider from './GhostProvider';

export default function DemoLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="w-full h-full bg-transparent flex items-center justify-center font-sans text-white overflow-hidden">
      {/* Phone Wrapper */}
      <div className="w-[390px] h-[844px] bg-black rounded-[3rem] border-[14px] border-neutral-800 shadow-[0_0_50px_rgba(0,0,0,0.5)] relative overflow-hidden flex flex-col">
        {/* Dynamic Island / Notch */}
        <div className="absolute top-0 inset-x-0 h-7 flex justify-center z-50">
          <div className="w-32 h-7 bg-black rounded-b-3xl"></div>
        </div>
        
        {/* The App Content wrapped in GhostProvider for onboarding bypass */}
        <GhostProvider>
          {children}
        </GhostProvider>
      </div>
    </div>
  );
}
