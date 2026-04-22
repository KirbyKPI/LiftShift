import React from 'react';
import { LogIn } from 'lucide-react';
import { assetPath } from '../../constants';

type NavigationProps = {
  activeNav?: 'how-it-works' | 'features' | null;
  variant?: 'landing' | 'info';
  className?: string;
};

export const Navigation: React.FC<NavigationProps> = ({
  activeNav = null,
  variant = 'landing',
  className = ''
}) => {
  return (
    <header className={`h-20 sm:h-24 flex items-center justify-between ${className}`}>
      {/* Logo on the left */}
      <a href={assetPath('/')} className="flex items-center gap-2 sm:gap-3 rounded-xl px-1.5 sm:px-2 py-1 hover:bg-white/5 transition-colors">
        <img src={assetPath('/UI/logo.png')} alt="KPIFit Training Logo" className="w-6 h-6 sm:w-8 sm:h-8" />
        <span className="text-white font-semibold text-sm sm:text-xl">KPIFit Training</span>
      </a>

      {/* Sign in button - Desktop */}
      <div className="hidden sm:flex items-center">
        <a
          href="/login"
          className="group inline-flex items-center gap-2 px-4 py-2 rounded-full transition-all duration-200 text-xs font-medium bg-emerald-500/15 border border-emerald-500/40 text-emerald-300 shadow-lg shadow-emerald-500/10 hover:bg-emerald-500/25 hover:border-emerald-400 hover:text-emerald-200 hover:shadow-emerald-500/30"
        >
          <LogIn className="w-3.5 h-3.5 group-hover:text-emerald-200 transition-colors" />
          <span>Sign in</span>
        </a>
      </div>

      {/* Mobile */}
      <div className="sm:hidden flex items-center">
        <a
          href="/login"
          className="inline-flex items-center gap-1 text-xs text-emerald-300 hover:text-emerald-200 px-1.5 py-1"
        >
          <LogIn className="w-2.5 h-2.5" />
          <span>Sign in</span>
        </a>
      </div>
    </header>
  );
};
