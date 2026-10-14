import React, { useState } from 'react';
import { 
  Menu, 
  X, 
  ExternalLink, 
  ChevronRight, 
  Award, 
  Calendar, 
  BookOpen, 
  Users, 
  CheckCircle2, 
  ArrowRight,
  ShieldCheck,
  Sparkles,
  Layers,
  BarChart3,
  Phone,
  Mail,
  MapPin,
  Flame,
  FileText
} from 'lucide-react';
import { useApp } from '../context/AppContext';
import { HISTORICAL_MILESTONES, APPRECIATION_PROFILES, HISTORICAL_SOCIAL_INSIGHTS } from '../data/historyData';

interface PublicWebsiteProps {
  onNavigateToDashboard: () => void;
  onNavigateToJoin: () => void;
}

export const PublicWebsite: React.FC<PublicWebsiteProps> = ({ 
  onNavigateToDashboard, 
  onNavigateToJoin 
}) => {
  const { websiteContent, seasonEvents, committees } = useApp();
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [activeHistoryTab, setActiveHistoryTab] = useState(0);

  const navLinks = [
    { label: 'Home', href: '#home' },
    { label: 'About Us', href: '#about' },
    { label: 'Vision 2027', href: '#vision' },
    { label: 'Our History', href: '#history' },
    { label: 'Appreciation', href: '#appreciation' },
    { label: 'Committees', href: '#committees' },
    { label: 'Events', href: '#events' },
    { label: 'Magazine', href: '#magazine' },
    { label: 'Meta Insights', href: '#insights' },
    { label: 'Contact', href: '#contact' },
  ];

  return (
    <div className="min-h-screen bg-[#FDFBF7] text-slate-900 selection:bg-[#F59A16] selection:text-white font-sans">
      {/* Top Banner */}
      <div className="bg-[#123B60] text-white text-xs py-2 px-4 border-b border-[#1D5485]">
        <div className="max-w-7xl mx-auto flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <span className="inline-block w-2 h-2 rounded-full bg-[#F59A16] animate-pulse"></span>
            <span className="font-semibold tracking-wide uppercase">ESME CU Student Chapter • Cairo University</span>
            <span className="text-slate-300 hidden md:inline">| Faculty of Engineering</span>
          </div>
          <div className="flex items-center gap-4 text-slate-300">
            <span className="italic font-medium text-[#F59A16]">"Be Positive Valuable"</span>
            <button 
              onClick={onNavigateToDashboard}
              className="text-xs bg-[#F59A16] hover:bg-[#D47F0A] text-white px-3 py-1 rounded font-semibold transition shadow-sm"
            >
              Portal Login &rarr;
            </button>
          </div>
        </div>
      </div>

      {/* Main Sticky Navbar */}
      <nav className="sticky top-0 z-50 bg-[#123B60]/95 backdrop-blur-md border-b border-white/10 text-white shadow-lg">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex items-center justify-between h-20">
            {/* Logo */}
            <a href="#home" className="flex items-center gap-3 group">
              <div className="bg-white p-1.5 rounded-lg shadow-md border border-white/20 transition group-hover:scale-105">
                <img 
                  src="/branding/esme_logo.png" 
                  alt="ESME Logo" 
                  className="h-10 w-auto object-contain"
                />
              </div>
              <div className="flex flex-col">
                <span className="text-lg font-black tracking-wider text-white leading-tight font-serif">ESME CU</span>
                <span className="text-[10px] tracking-widest text-[#F59A16] font-bold uppercase">Cairo Student Chapter</span>
              </div>
            </a>

            {/* Desktop Navigation Links */}
            <div className="hidden xl:flex items-center space-x-1">
              {navLinks.map((link) => (
                <a
                  key={link.label}
                  href={link.href}
                  className="px-3 py-1.5 rounded text-xs font-semibold text-slate-200 hover:text-white hover:bg-white/10 transition"
                >
                  {link.label}
                </a>
              ))}
            </div>

            {/* Right CTAs */}
            <div className="hidden lg:flex items-center space-x-3">
              <button
                onClick={onNavigateToDashboard}
                className="px-4 py-2 text-xs font-bold text-white border border-[#F59A16] rounded-lg hover:bg-[#F59A16]/20 transition flex items-center gap-1.5"
              >
                <ShieldCheck className="w-3.5 h-3.5 text-[#F59A16]" />
                Internal System
              </button>
              <button
                onClick={onNavigateToJoin}
                className="px-5 py-2 text-xs font-bold text-white bg-[#F59A16] hover:bg-[#D47F0A] rounded-lg shadow-md shadow-[#F59A16]/20 transition flex items-center gap-1.5"
              >
                Join Chapter
                <ArrowRight className="w-3.5 h-3.5" />
              </button>
            </div>

            {/* Mobile menu button */}
            <div className="xl:hidden flex items-center gap-2">
              <button
                onClick={onNavigateToDashboard}
                className="px-3 py-1.5 text-xs font-bold text-white bg-[#F59A16] rounded-md"
              >
                Login
              </button>
              <button
                onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
                className="p-2 rounded-md text-slate-300 hover:text-white hover:bg-white/10"
              >
                {mobileMenuOpen ? <X className="w-6 h-6" /> : <Menu className="w-6 h-6" />}
              </button>
            </div>
          </div>
        </div>

        {/* Mobile menu dropdown */}
        {mobileMenuOpen && (
          <div className="xl:hidden bg-[#0A2239] border-b border-white/10 px-4 pt-2 pb-6 space-y-2 animate-in slide-in-from-top">
            {navLinks.map((link) => (
              <a
                key={link.label}
                href={link.href}
                onClick={() => setMobileMenuOpen(false)}
                className="block px-3 py-2 rounded-md text-sm font-medium text-slate-200 hover:text-white hover:bg-white/10"
              >
                {link.label}
              </a>
            ))}
            <div className="pt-4 border-t border-white/10 flex flex-col gap-2">
              <button
                onClick={() => { setMobileMenuOpen(false); onNavigateToDashboard(); }}
                className="w-full text-center py-2.5 rounded-md text-xs font-bold text-white border border-[#F59A16]"
              >
                Dashboard Login
              </button>
              <button
                onClick={() => { setMobileMenuOpen(false); onNavigateToJoin(); }}
                className="w-full text-center py-2.5 rounded-md text-xs font-bold text-white bg-[#F59A16]"
              >
                Recruitment 2026-2027
              </button>
            </div>
          </div>
        )}
      </nav>

      {/* Hero Section */}
      <section id="home" className="relative overflow-hidden bg-gradient-to-b from-[#123B60] via-[#0E2F4D] to-[#0A2239] text-white pt-16 pb-28">
        {/* Subtle engineering decorative grid */}
        <div className="absolute inset-0 bg-grid-pattern-dark opacity-15 pointer-events-none"></div>
        <div className="absolute -top-32 -right-32 w-96 h-96 bg-[#F59A16]/10 rounded-full blur-3xl pointer-events-none"></div>
        <div className="absolute bottom-0 -left-20 w-80 h-80 bg-[#1D5485]/20 rounded-full blur-2xl pointer-events-none"></div>

        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 relative z-10">
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-12 items-center">
            
            {/* Left Column Text */}
            <div className="lg:col-span-7 space-y-6">
              <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-white/10 border border-white/20 text-[#F59A16] text-xs font-semibold backdrop-blur-sm">
                <Sparkles className="w-3.5 h-3.5" />
                <span>{websiteContent.hero.badge}</span>
              </div>

              <h1 className="text-4xl sm:text-5xl lg:text-6xl font-black tracking-tight text-white leading-tight">
                {websiteContent.hero.headline}
              </h1>

              <p className="text-lg sm:text-xl text-slate-200 leading-relaxed font-light border-l-4 border-[#F59A16] pl-4">
                {websiteContent.hero.supportingMessage}
              </p>

              {/* Motto highlight */}
              <div className="inline-block bg-[#F59A16]/15 border border-[#F59A16]/30 px-4 py-2 rounded-lg text-sm text-[#F59A16] font-bold">
                Chapter Core Motto: <span className="underline uppercase tracking-wider">BE POSITIVE VALUABLE</span>
              </div>

              {/* CTAs */}
              <div className="pt-4 flex flex-wrap items-center gap-4">
                <button
                  onClick={onNavigateToDashboard}
                  className="px-7 py-3.5 bg-[#F59A16] hover:bg-[#D47F0A] text-white font-bold rounded-xl shadow-xl shadow-[#F59A16]/25 transition flex items-center gap-2 group text-sm"
                >
                  <ShieldCheck className="w-4 h-4 transition group-hover:scale-110" />
                  {websiteContent.hero.ctaPrimary}
                </button>
                <button
                  onClick={onNavigateToJoin}
                  className="px-7 py-3.5 bg-white/10 hover:bg-white/20 text-white font-semibold rounded-xl border border-white/20 transition flex items-center gap-2 text-sm backdrop-blur-sm"
                >
                  {websiteContent.hero.ctaSecondary}
                  <ChevronRight className="w-4 h-4" />
                </button>
              </div>

              {/* Quick credibility counters */}
              <div className="pt-8 grid grid-cols-3 gap-6 border-t border-white/15">
                <div>
                  <div className="text-2xl sm:text-3xl font-extrabold text-[#F59A16]">2009</div>
                  <div className="text-xs text-slate-300">Society Founded</div>
                </div>
                <div>
                  <div className="text-2xl sm:text-3xl font-extrabold text-white">2015</div>
                  <div className="text-xs text-slate-300">Cairo Chapter Active</div>
                </div>
                <div>
                  <div className="text-2xl sm:text-3xl font-extrabold text-[#F59A16]">4 Major</div>
                  <div className="text-xs text-slate-300">Annual Summits</div>
                </div>
              </div>
            </div>

            {/* Right Column Official Brand Imagery */}
            <div className="lg:col-span-5 space-y-4">
              <div className="relative rounded-2xl overflow-hidden border-2 border-white/20 shadow-2xl bg-[#0A2239]">
                <img 
                  src="/branding/esme_team_celebration.png" 
                  alt="ESME CU Student Chapter Celebration" 
                  className="w-full h-80 object-cover object-center filter saturate-105"
                />
                <div className="absolute inset-0 bg-gradient-to-t from-[#0A2239] via-transparent to-transparent"></div>
                <div className="absolute bottom-4 left-4 right-4 text-white">
                  <span className="px-2.5 py-1 bg-[#F59A16] text-[10px] font-black uppercase rounded tracking-wider">Official 2026-2027 Vision Launch</span>
                  <p className="text-xs text-slate-200 mt-1">Zerust Presentation & ESME-Cairo University General Assembly</p>
                </div>
              </div>

              {/* Secondary recruitment badge */}
              <div className="p-4 rounded-xl bg-white/10 backdrop-blur-md border border-white/15 flex items-center gap-4">
                <div className="w-12 h-12 rounded-lg bg-[#F59A16] flex items-center justify-center shrink-0">
                  <Flame className="w-6 h-6 text-white" />
                </div>
                <div className="text-xs">
                  <div className="font-bold text-white text-sm">Empowering Engineers</div>
                  <div className="text-slate-300">Materials Science • NDT Inspection • AI Systems • Industry 4.0</div>
                </div>
              </div>
            </div>

          </div>
        </div>
      </section>

      {/* About Section */}
      <section id="about" className="py-20 bg-white border-b border-slate-200 relative">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="text-center max-w-3xl mx-auto mb-16">
            <span className="text-xs font-bold uppercase tracking-widest text-[#F59A16]">Authoritative Profile</span>
            <h2 className="text-3xl sm:text-4xl font-extrabold text-[#123B60] mt-2">
              {websiteContent.about.title}
            </h2>
            <div className="w-16 h-1 bg-[#F59A16] mx-auto mt-4 rounded-full"></div>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-12 gap-10 items-start">
            <div className="lg:col-span-7 space-y-6 text-slate-700 leading-relaxed">
              <div className="p-6 bg-[#FDFBF7] rounded-2xl border border-slate-200 shadow-sm">
                <h3 className="text-lg font-bold text-[#123B60] mb-2">Our Origins & Foundations</h3>
                <p className="text-sm text-slate-600 mb-3">{websiteContent.about.story}</p>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-2 text-xs text-slate-500">
                  <div className="flex items-center gap-2">
                    <CheckCircle2 className="w-4 h-4 text-[#F59A16]" />
                    <span>Founded: <strong>{websiteContent.about.foundedYear}</strong></span>
                  </div>
                  <div className="flex items-center gap-2">
                    <CheckCircle2 className="w-4 h-4 text-[#F59A16]" />
                    <span>Faculty: <strong>{websiteContent.about.foundingFaculty}</strong></span>
                  </div>
                  <div className="flex items-center gap-2">
                    <CheckCircle2 className="w-4 h-4 text-[#F59A16]" />
                    <span>Branch: <strong>{websiteContent.about.cairoChapterFounded}</strong></span>
                  </div>
                  <div className="flex items-center gap-2">
                    <CheckCircle2 className="w-4 h-4 text-[#F59A16]" />
                    <span>Affiliation: <strong>Cairo University Faculty of Engineering</strong></span>
                  </div>
                </div>
              </div>

              <div className="p-6 bg-slate-50 rounded-2xl border border-slate-200">
                <h3 className="text-lg font-bold text-[#123B60] mb-2">Chapter Purpose & Objectives</h3>
                <p className="text-sm text-slate-600 mb-4">{websiteContent.about.purpose}</p>
                <ul className="space-y-2.5">
                  {websiteContent.about.objectives.map((obj, i) => (
                    <li key={i} className="flex items-start gap-2.5 text-xs text-slate-700">
                      <div className="w-5 h-5 rounded-full bg-[#123B60] text-white flex items-center justify-center shrink-0 text-[10px] font-bold mt-0.5">
                        {i + 1}
                      </div>
                      <span>{obj}</span>
                    </li>
                  ))}
                </ul>
              </div>
            </div>

            <div className="lg:col-span-5 space-y-4">
              <div className="p-6 bg-gradient-to-br from-[#123B60] to-[#0A2239] rounded-2xl text-white shadow-xl">
                <h3 className="text-lg font-bold text-[#F59A16] mb-3">Core Chapter Values</h3>
                <div className="space-y-3">
                  {websiteContent.about.values.map((val, idx) => (
                    <div key={idx} className="flex items-center justify-between p-3 rounded-lg bg-white/10 border border-white/10 text-xs font-semibold">
                      <span>{val}</span>
                      <CheckCircle2 className="w-4 h-4 text-[#F59A16]" />
                    </div>
                  ))}
                </div>
              </div>

              {/* Campus monument photo from PDF xref_585 */}
              <div className="rounded-2xl overflow-hidden border border-slate-200 shadow-md relative group">
                <img 
                  src="/history/xref_585.png" 
                  alt="Faculty of Engineering, Cairo University" 
                  className="w-full h-56 object-cover filter brightness-90 group-hover:scale-105 transition duration-500"
                />
                <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-transparent to-transparent flex items-end p-4">
                  <div className="text-white text-xs">
                    <p className="font-bold text-sm">Faculty of Engineering • Cairo University</p>
                    <p className="text-slate-300">Distinguished academic home of ESME CU Chapter</p>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Official Vision 2026-2027 Section */}
      <section id="vision" className="py-20 bg-slate-900 text-white relative overflow-hidden">
        <div className="absolute inset-0 bg-grid-pattern-dark opacity-10 pointer-events-none"></div>
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 relative z-10">
          
          <div className="text-center max-w-4xl mx-auto mb-14">
            <span className="text-xs font-extrabold uppercase tracking-widest text-[#F59A16]">Strategic Plan 2026–2027</span>
            <h2 className="text-3xl sm:text-4xl font-black mt-2 tracking-tight">
              {websiteContent.vision2027.headline}
            </h2>
            <blockquote className="text-xl sm:text-2xl font-serif italic text-[#F59A16] mt-4 border-y border-white/10 py-4 max-w-3xl mx-auto">
              {websiteContent.vision2027.quote}
            </blockquote>
            <p className="text-sm text-slate-300 mt-4 leading-relaxed font-light">
              {websiteContent.vision2027.description}
            </p>
          </div>

          {/* 4 Strategic Focus Areas */}
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
            {websiteContent.vision2027.pillars.map((pillar, idx) => (
              <div 
                key={idx}
                className="bg-white/5 border border-white/10 rounded-2xl p-6 hover:bg-white/10 transition backdrop-blur-sm flex flex-col justify-between"
              >
                <div>
                  <div className="w-10 h-10 rounded-xl bg-[#F59A16]/20 border border-[#F59A16] text-[#F59A16] flex items-center justify-center font-bold text-sm mb-4">
                    0{idx + 1}
                  </div>
                  <h3 className="font-bold text-base text-white mb-2 leading-snug">{pillar.title}</h3>
                  <p className="text-xs text-slate-300 mb-4 leading-relaxed">{pillar.description}</p>
                </div>
                <div className="space-y-1.5 pt-3 border-t border-white/10">
                  {pillar.points.map((pt, pIdx) => (
                    <div key={pIdx} className="flex items-start gap-1.5 text-[11px] text-slate-400">
                      <span className="text-[#F59A16] font-bold">•</span>
                      <span>{pt}</span>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>

        </div>
      </section>

      {/* Historical Milestones (2015 - 2023) */}
      <section id="history" className="py-20 bg-white border-b border-slate-200">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          
          <div className="text-center max-w-3xl mx-auto mb-14">
            <span className="text-xs font-bold uppercase tracking-widest text-[#F59A16]">Visual Timeline</span>
            <h2 className="text-3xl sm:text-4xl font-extrabold text-[#123B60] mt-2">
              Verified Chapter History (2015–2023)
            </h2>
            <p className="text-xs text-slate-500 mt-2">
              Documented milestones from foundation through safety training, field trips, and EISC conferences.
            </p>
            <div className="w-16 h-1 bg-[#F59A16] mx-auto mt-4 rounded-full"></div>
          </div>

          {/* Historical Period Tabs */}
          <div className="flex flex-wrap items-center justify-center gap-2 mb-10">
            {HISTORICAL_MILESTONES.map((m, idx) => (
              <button
                key={m.period}
                onClick={() => setActiveHistoryTab(idx)}
                className={`px-4 py-2.5 rounded-xl text-xs font-bold transition flex items-center gap-2 ${
                  activeHistoryTab === idx
                    ? 'bg-[#123B60] text-white shadow-md'
                    : 'bg-slate-100 text-slate-700 hover:bg-slate-200'
                }`}
              >
                <span>{m.period}</span>
                <span className={`text-[10px] px-2 py-0.5 rounded-full ${
                  activeHistoryTab === idx ? 'bg-[#F59A16] text-white' : 'bg-slate-300 text-slate-800'
                }`}>
                  {m.activities.length} Events
                </span>
              </button>
            ))}
          </div>

          {/* Active Period Detail */}
          {HISTORICAL_MILESTONES[activeHistoryTab] && (
            <div className="bg-[#FDFBF7] border border-slate-200 rounded-2xl p-6 sm:p-8 shadow-sm">
              <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 items-start">
                
                <div className="lg:col-span-7 space-y-4">
                  <div className="flex items-center gap-3">
                    <span className="text-2xl font-black text-[#123B60]">{HISTORICAL_MILESTONES[activeHistoryTab].period}</span>
                    <span className="text-xs px-3 py-1 bg-[#F59A16]/15 text-[#D47F0A] font-bold rounded-full">
                      {HISTORICAL_MILESTONES[activeHistoryTab].badge}
                    </span>
                  </div>

                  <p className="text-sm text-slate-700 leading-relaxed font-medium">
                    {HISTORICAL_MILESTONES[activeHistoryTab].summary}
                  </p>

                  <div className="pt-2">
                    <h4 className="text-xs font-bold uppercase tracking-wider text-slate-500 mb-3">Documented Activities & Records</h4>
                    <div className="space-y-2">
                      {HISTORICAL_MILESTONES[activeHistoryTab].activities.map((act, i) => (
                        <div key={i} className="p-3 bg-white rounded-xl border border-slate-200 flex items-start justify-between gap-3 text-xs">
                          <div>
                            <div className="font-bold text-[#123B60]">{act.name}</div>
                            <div className="text-slate-500 text-[11px] mt-0.5">{act.notes}</div>
                          </div>
                          <div className="text-right shrink-0">
                            <span className="px-2 py-0.5 rounded bg-slate-100 text-slate-700 font-semibold text-[10px]">
                              {act.type}
                            </span>
                            <div className="text-[10px] text-[#F59A16] font-bold mt-1">{act.year}</div>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>

                <div className="lg:col-span-5 space-y-4">
                  {HISTORICAL_MILESTONES[activeHistoryTab].image && (
                    <div className="rounded-2xl overflow-hidden border border-slate-200 shadow-md">
                      <img 
                        src={HISTORICAL_MILESTONES[activeHistoryTab].image} 
                        alt={HISTORICAL_MILESTONES[activeHistoryTab].period} 
                        className="w-full h-64 object-cover object-top"
                      />
                      <div className="p-3 bg-white text-[11px] text-slate-500 border-t border-slate-200">
                        Official Historical Archive • Cairo University Student Chapter Record
                      </div>
                    </div>
                  )}
                </div>

              </div>
            </div>
          )}

        </div>
      </section>

      {/* Academic Appreciation and Alumni Section */}
      <section id="appreciation" className="py-20 bg-slate-50 border-b border-slate-200">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          
          <div className="text-center max-w-3xl mx-auto mb-14">
            <span className="text-xs font-bold uppercase tracking-widest text-[#F59A16]">Alumni & Faculty Honour</span>
            <h2 className="text-3xl sm:text-4xl font-extrabold text-[#123B60] mt-2">
              Academic Appreciation
            </h2>
            <p className="text-xs text-slate-600 mt-2 max-w-2xl mx-auto leading-relaxed">
              "ESME Cairo proudly affirms its role as an incubator for excellence and leadership in engineering, celebrating former members who now represent the pinnacle of distinction as Doctors and Teaching Assistants at the Faculty."
            </p>
            <div className="w-16 h-1 bg-[#F59A16] mx-auto mt-4 rounded-full"></div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
            {APPRECIATION_PROFILES.map((prof) => (
              <div 
                key={prof.id}
                className="bg-white rounded-2xl border border-slate-200 shadow-sm hover:shadow-lg transition p-6 flex flex-col justify-between"
              >
                <div>
                  <div className="w-full h-56 rounded-xl overflow-hidden border-2 border-slate-100 shadow-inner mb-5 bg-slate-100">
                    <img 
                      src={prof.image} 
                      alt={prof.name} 
                      className="w-full h-full object-cover object-top"
                    />
                  </div>

                  <div className="inline-block px-2.5 py-1 rounded bg-[#123B60]/10 text-[#123B60] text-[10px] font-bold uppercase tracking-wider mb-2">
                    {prof.title}
                  </div>

                  <h3 className="text-xl font-bold text-[#123B60]">{prof.name}</h3>
                  <p className="text-xs font-semibold text-[#F59A16] mt-0.5">{prof.role}</p>
                  <p className="text-xs text-slate-500 mt-0.5">{prof.department}</p>

                  <p className="text-xs text-slate-600 mt-4 leading-relaxed border-t border-slate-100 pt-3">
                    {prof.bio}
                  </p>
                </div>

                <div className="mt-5 pt-3 border-t border-slate-100 flex items-center justify-between text-[11px] text-slate-500">
                  <span className="flex items-center gap-1 text-emerald-600 font-semibold">
                    <CheckCircle2 className="w-3.5 h-3.5" />
                    Verified Alumni
                  </span>
                  <span className="italic text-slate-400">Source: PDF p.3</span>
                </div>
              </div>
            ))}
          </div>

          {/* Board to Year 2025/2026 Poster Gallery */}
          <div className="mt-16 bg-[#123B60] rounded-2xl p-6 sm:p-8 text-white relative overflow-hidden">
            <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 items-center">
              <div className="lg:col-span-5 space-y-4">
                <span className="px-3 py-1 bg-[#F59A16] text-[10px] font-black uppercase rounded tracking-wider">Historical Board Roster</span>
                <h3 className="text-2xl font-bold text-white">Board to Year 25/26 Leadership</h3>
                <p className="text-xs text-slate-300 leading-relaxed">
                  Preserving the official roster from the recruitment archive: President Ahmed Abbas, Vice President Omar Mohamed, Secretary Nada Yehia, along with HR, PR, OC, TE, TR, and MM directors.
                </p>
                <div className="text-xs text-[#F59A16] font-semibold">
                  Official archive source: doc_p8_img0_732.png
                </div>
              </div>
              <div className="lg:col-span-7">
                <div className="rounded-xl overflow-hidden border border-white/20 shadow-2xl">
                  <img 
                    src="/branding/board_poster_2025_2026.png" 
                    alt="Board to Year 25/26" 
                    className="w-full h-auto object-cover"
                  />
                </div>
              </div>
            </div>
          </div>

        </div>
      </section>

      {/* Committees Section */}
      <section id="committees" className="py-20 bg-white border-b border-slate-200">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          
          <div className="text-center max-w-3xl mx-auto mb-14">
            <span className="text-xs font-bold uppercase tracking-widest text-[#F59A16]">Organizational Pillars</span>
            <h2 className="text-3xl sm:text-4xl font-extrabold text-[#123B60] mt-2">
              Official Chapter Committees
            </h2>
            <p className="text-xs text-slate-500 mt-2">
              The operational engines driving workshops, design templates, field marketing, and technical publications.
            </p>
            <div className="w-16 h-1 bg-[#F59A16] mx-auto mt-4 rounded-full"></div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
            {committees.map((comm) => (
              <div 
                key={comm.id}
                className="bg-[#FDFBF7] border border-slate-200 rounded-2xl p-6 sm:p-8 hover:shadow-lg transition flex flex-col justify-between"
              >
                <div>
                  <div className="flex items-center justify-between gap-3 mb-4">
                    <span className="px-3 py-1 bg-[#123B60] text-white text-xs font-black rounded-lg">
                      {comm.shortCode}
                    </span>
                    <span className="text-xs font-bold text-[#F59A16] uppercase tracking-wider">
                      {comm.memberCount} Active Members
                    </span>
                  </div>

                  <h3 className="text-xl font-bold text-[#123B60] mb-2">{comm.name}</h3>
                  <p className="text-xs text-slate-600 leading-relaxed mb-4">{comm.description}</p>

                  <div className="p-4 bg-white rounded-xl border border-slate-200 mb-4 text-xs space-y-1.5">
                    <div className="text-slate-500">Director: <strong className="text-slate-800">{comm.directorName || 'Assigned by Admin'}</strong></div>
                    <div className="text-slate-500">Head: <strong className="text-slate-800">{comm.headName || 'Assigned by Admin'}</strong></div>
                  </div>

                  <div className="space-y-2 mb-4">
                    <div className="text-[11px] font-bold text-slate-500 uppercase tracking-wider">Sub-Teams & Workstreams:</div>
                    <div className="flex flex-wrap gap-1.5">
                      {comm.subTeams.map((team, idx) => (
                        <span key={idx} className="px-2.5 py-1 bg-white border border-slate-200 text-slate-700 text-[11px] rounded-md font-medium">
                          {team}
                        </span>
                      ))}
                    </div>
                  </div>
                </div>

                <div className="pt-4 border-t border-slate-200">
                  <div className="text-[11px] font-bold text-slate-500 uppercase tracking-wider mb-2">Key Season Targets:</div>
                  <ul className="space-y-1 text-xs text-slate-600">
                    {comm.objectives.slice(0, 2).map((obj, i) => (
                      <li key={i} className="flex items-center gap-1.5">
                        <CheckCircle2 className="w-3.5 h-3.5 text-[#F59A16] shrink-0" />
                        <span className="truncate">{obj}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              </div>
            ))}
          </div>

        </div>
      </section>

      {/* Events & Season Calendar */}
      <section id="events" className="py-20 bg-slate-50 border-b border-slate-200">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          
          <div className="text-center max-w-3xl mx-auto mb-14">
            <span className="text-xs font-bold uppercase tracking-widest text-[#F59A16]">Season Roadmap</span>
            <h2 className="text-3xl sm:text-4xl font-extrabold text-[#123B60] mt-2">
              Master Calendar & Events (2026–2027)
            </h2>
            <p className="text-xs text-slate-500 mt-2">
              4 major summits, 10 specialized workshops, and 32 professional sessions planned.
            </p>
            <div className="w-16 h-1 bg-[#F59A16] mx-auto mt-4 rounded-full"></div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
            {seasonEvents.filter(e => e.category === 'Major Event').map((evt) => (
              <div 
                key={evt.id}
                className="bg-white border-2 border-[#123B60]/10 rounded-2xl p-6 shadow-sm hover:shadow-md transition flex flex-col justify-between"
              >
                <div>
                  <div className="flex items-center justify-between text-xs font-bold mb-3">
                    <span className="px-2.5 py-1 rounded bg-[#123B60] text-white text-[10px] uppercase tracking-wider">
                      {evt.acronym || 'Summit'}
                    </span>
                    <span className="text-[#F59A16]">{evt.status}</span>
                  </div>

                  <h3 className="text-lg font-bold text-[#123B60] leading-tight mb-2">{evt.title}</h3>
                  <div className="text-xs font-semibold text-slate-500 mb-3">{evt.dateOrQuarter}</div>
                  <p className="text-xs text-slate-600 mb-4 leading-relaxed">{evt.description}</p>
                </div>

                <div className="pt-3 border-t border-slate-100 text-[11px] text-slate-500">
                  <div>Target: <strong className="text-slate-800">{evt.targetMetric}</strong></div>
                  {evt.actualMetric && (
                    <div className="text-emerald-600 font-semibold mt-0.5">Progress: {evt.actualMetric}</div>
                  )}
                </div>
              </div>
            ))}
          </div>

          {/* Workshop Track Summary from Vision PDF */}
          <div className="mt-12 bg-white rounded-2xl p-6 sm:p-8 border border-slate-200">
            <h3 className="text-lg font-bold text-[#123B60] mb-4 flex items-center gap-2">
              <BookOpen className="w-5 h-5 text-[#F59A16]" />
              Workshops & Capability Building Tracks (Feb–Jul 2027)
            </h3>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-4 text-xs">
              <div className="p-4 bg-slate-50 rounded-xl border border-slate-200">
                <span className="text-[10px] font-bold text-[#F59A16] uppercase">Feb 2027 • 2-3 Days</span>
                <h4 className="font-bold text-[#123B60] mt-1">NDT / Inspection</h4>
                <p className="text-slate-500 text-[11px] mt-1">Ultrasonic, Radiography & Magnetic Particle.</p>
              </div>
              <div className="p-4 bg-slate-50 rounded-xl border border-slate-200">
                <span className="text-[10px] font-bold text-[#F59A16] uppercase">Mar 2027 • 2 Days</span>
                <h4 className="font-bold text-[#123B60] mt-1">Materials Testing</h4>
                <p className="text-slate-500 text-[11px] mt-1">Tensile, impact, hardness & metallography.</p>
              </div>
              <div className="p-4 bg-slate-50 rounded-xl border border-slate-200">
                <span className="text-[10px] font-bold text-[#F59A16] uppercase">Apr 2027 • 3 Days</span>
                <h4 className="font-bold text-[#123B60] mt-1">Automation / AI</h4>
                <p className="text-slate-500 text-[11px] mt-1">Generative & Agentic AI in engineering.</p>
              </div>
              <div className="p-4 bg-slate-50 rounded-xl border border-slate-200">
                <span className="text-[10px] font-bold text-[#F59A16] uppercase">May 2027 • 2 Days</span>
                <h4 className="font-bold text-[#123B60] mt-1">Sustainability</h4>
                <p className="text-slate-500 text-[11px] mt-1">Green metallurgy & circular materials.</p>
              </div>
              <div className="p-4 bg-slate-50 rounded-xl border border-slate-200">
                <span className="text-[10px] font-bold text-[#F59A16] uppercase">Jun 2027 • 3 Days</span>
                <h4 className="font-bold text-[#123B60] mt-1">ANSYS & SolidWorks</h4>
                <p className="text-slate-500 text-[11px] mt-1">FEA simulation and structural design.</p>
              </div>
            </div>
          </div>

        </div>
      </section>

      {/* Scientific Magazine Section */}
      <section id="magazine" className="py-20 bg-white border-b border-slate-200">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          
          <div className="text-center max-w-3xl mx-auto mb-14">
            <span className="text-xs font-bold uppercase tracking-widest text-[#F59A16]">Quarterly Publication Engine</span>
            <h2 className="text-3xl sm:text-4xl font-extrabold text-[#123B60] mt-2">
              ESME Scientific Magazine
            </h2>
            <p className="text-xs text-slate-500 mt-2">
              A company-academic publication engine linking real science, industry, and emerging technology.
            </p>
            <div className="w-16 h-1 bg-[#F59A16] mx-auto mt-4 rounded-full"></div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
            <div className="p-6 bg-[#FDFBF7] rounded-2xl border-2 border-[#123B60]/20 flex flex-col justify-between">
              <div>
                <span className="px-2.5 py-1 rounded bg-[#F59A16] text-white text-[10px] font-bold uppercase">Issue 1 • December 2026</span>
                <h3 className="text-xl font-bold text-[#123B60] mt-3">Materials & Manufacturing</h3>
                <p className="text-xs text-slate-600 mt-2 leading-relaxed">
                  Focusing on advanced alloy development, heat treatment protocols, and modern steelmaking innovations.
                </p>
                <div className="mt-4 p-3 bg-white rounded-xl border border-slate-200 text-xs text-slate-500 space-y-1">
                  <div>Status: <strong className="text-amber-600">In Preparation</strong></div>
                  <div>Target Partners: <strong className="text-slate-700">3-5 Industrial Contributors</strong></div>
                </div>
              </div>
              <div className="mt-6 pt-4 border-t border-slate-200 text-[11px] text-slate-400">
                Template 1: Classic Academic Research Layout
              </div>
            </div>

            <div className="p-6 bg-[#FDFBF7] rounded-2xl border border-slate-200 flex flex-col justify-between">
              <div>
                <span className="px-2.5 py-1 rounded bg-[#123B60] text-white text-[10px] font-bold uppercase">Issue 2 • March 2027</span>
                <h3 className="text-xl font-bold text-[#123B60] mt-3">Inspection & Reliability</h3>
                <p className="text-xs text-slate-600 mt-2 leading-relaxed">
                  Dedicated to QA/QC frameworks, ultrasonic flaw identification, and asset integrity management.
                </p>
                <div className="mt-4 p-3 bg-white rounded-xl border border-slate-200 text-xs text-slate-500 space-y-1">
                  <div>Status: <strong className="text-slate-600">Planned (Q2)</strong></div>
                  <div>Target Partners: <strong className="text-slate-700">3-5 Industrial Contributors</strong></div>
                </div>
              </div>
              <div className="mt-6 pt-4 border-t border-slate-200 text-[11px] text-slate-400">
                Template 2: Modern Visual Infographics
              </div>
            </div>

            <div className="p-6 bg-[#FDFBF7] rounded-2xl border border-slate-200 flex flex-col justify-between">
              <div>
                <span className="px-2.5 py-1 rounded bg-[#123B60] text-white text-[10px] font-bold uppercase">Issue 3 • June 2027</span>
                <h3 className="text-xl font-bold text-[#123B60] mt-3">Smart Materials & Industry 4.0</h3>
                <p className="text-xs text-slate-600 mt-2 leading-relaxed">
                  Examining self-healing coatings, shape memory alloys, and generative AI in generative design.
                </p>
                <div className="mt-4 p-3 bg-white rounded-xl border border-slate-200 text-xs text-slate-500 space-y-1">
                  <div>Status: <strong className="text-slate-600">Planned (Q3)</strong></div>
                  <div>Target Partners: <strong className="text-slate-700">3-5 Industrial Contributors</strong></div>
                </div>
              </div>
              <div className="mt-6 pt-4 border-t border-slate-200 text-[11px] text-slate-400">
                Template 3: Interactive Quick Topics & Interviews
              </div>
            </div>
          </div>

        </div>
      </section>

      {/* Meta Insights Report Snapshot (October 2026) */}
      <section id="insights" className="py-20 bg-slate-900 text-white relative">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          
          <div className="text-center max-w-3xl mx-auto mb-14">
            <span className="px-3 py-1 rounded-full bg-[#F59A16]/20 border border-[#F59A16] text-[#F59A16] text-xs font-bold">
              Archived Snapshot • {HISTORICAL_SOCIAL_INSIGHTS.reportDate}
            </span>
            <h2 className="text-3xl sm:text-4xl font-extrabold text-white mt-3">
              Official Social Media Insights
            </h2>
            <p className="text-xs text-slate-300 mt-2">
              Performance analysis showing how ESME-Cairo University content drives reach among engineering students.
            </p>
            <div className="w-16 h-1 bg-[#F59A16] mx-auto mt-4 rounded-full"></div>
          </div>

          {/* Metric cards */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-6 mb-12">
            <div className="p-6 bg-white/5 border border-white/10 rounded-2xl text-center">
              <div className="text-3xl sm:text-4xl font-extrabold text-[#F59A16]">{HISTORICAL_SOCIAL_INSIGHTS.totalViews.toLocaleString()}</div>
              <div className="text-xs text-slate-300 mt-1 font-semibold">Total Sample Views</div>
              <div className="text-[10px] text-slate-400 mt-0.5">4 analyzed posts</div>
            </div>
            <div className="p-6 bg-white/5 border border-white/10 rounded-2xl text-center">
              <div className="text-3xl sm:text-4xl font-extrabold text-white">{HISTORICAL_SOCIAL_INSIGHTS.avgViewsPerPost.toLocaleString()}</div>
              <div className="text-xs text-slate-300 mt-1 font-semibold">Avg. Views / Post</div>
              <div className="text-[10px] text-slate-400 mt-0.5">Strong organic baseline</div>
            </div>
            <div className="p-6 bg-white/5 border border-white/10 rounded-2xl text-center">
              <div className="text-3xl sm:text-4xl font-extrabold text-[#F59A16]">{HISTORICAL_SOCIAL_INSIGHTS.totalInteractions.toLocaleString()}</div>
              <div className="text-xs text-slate-300 mt-1 font-semibold">Total Interactions</div>
              <div className="text-[10px] text-slate-400 mt-0.5">Reactions, clicks & shares</div>
            </div>
            <div className="p-6 bg-white/5 border border-white/10 rounded-2xl text-center">
              <div className="text-3xl sm:text-4xl font-extrabold text-emerald-400">{HISTORICAL_SOCIAL_INSIGHTS.highestEngagementPost.engagementRate}</div>
              <div className="text-xs text-slate-300 mt-1 font-semibold">Peak Engagement</div>
              <div className="text-[10px] text-slate-400 mt-0.5">Recruitment Open post</div>
            </div>
          </div>

          {/* Recommendations from Report */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            {HISTORICAL_SOCIAL_INSIGHTS.strategicRecommendations.map((rec, i) => (
              <div key={i} className="p-5 bg-white/5 border border-white/10 rounded-xl">
                <div className="text-sm font-bold text-[#F59A16] mb-1">{rec.rule}</div>
                <div className="text-xs text-slate-300 leading-relaxed">{rec.detail}</div>
              </div>
            ))}
          </div>

        </div>
      </section>

      {/* Contact Section */}
      <section id="contact" className="py-20 bg-white">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-12 items-center">
            <div className="lg:col-span-6 space-y-6">
              <span className="text-xs font-bold uppercase tracking-widest text-[#F59A16]">Connect With ESME CU</span>
              <h2 className="text-3xl sm:text-4xl font-extrabold text-[#123B60]">
                Official Chapter Channels
              </h2>
              <p className="text-sm text-slate-600 leading-relaxed">
                Reach out to chapter leadership, inquire about corporate sponsorship, or propose technical collaboration.
              </p>

              <div className="space-y-4 pt-2">
                <div className="flex items-center gap-3 text-slate-700">
                  <div className="w-10 h-10 rounded-xl bg-[#123B60]/10 flex items-center justify-center text-[#123B60] shrink-0">
                    <Mail className="w-5 h-5" />
                  </div>
                  <div>
                    <div className="text-xs text-slate-500 font-semibold">Email</div>
                    <a href={`mailto:${websiteContent.contact.email}`} className="text-sm font-bold text-[#123B60] hover:text-[#F59A16]">
                      {websiteContent.contact.email}
                    </a>
                  </div>
                </div>

                <div className="flex items-center gap-3 text-slate-700">
                  <div className="w-10 h-10 rounded-xl bg-[#123B60]/10 flex items-center justify-center text-[#123B60] shrink-0">
                    <Phone className="w-5 h-5" />
                  </div>
                  <div>
                    <div className="text-xs text-slate-500 font-semibold">Phone</div>
                    <a href={`tel:${websiteContent.contact.phone}`} className="text-sm font-bold text-[#123B60]">
                      {websiteContent.contact.phone}
                    </a>
                  </div>
                </div>

                <div className="flex items-center gap-3 text-slate-700">
                  <div className="w-10 h-10 rounded-xl bg-[#123B60]/10 flex items-center justify-center text-[#123B60] shrink-0">
                    <MapPin className="w-5 h-5" />
                  </div>
                  <div>
                    <div className="text-xs text-slate-500 font-semibold">Location</div>
                    <div className="text-sm font-bold text-[#123B60]">
                      {websiteContent.contact.location}
                    </div>
                  </div>
                </div>
              </div>

              <div className="pt-4 flex items-center gap-3">
                <span className="text-xs font-bold text-slate-500 uppercase">Confirmed Social Handle:</span>
                <span className="px-3 py-1 bg-slate-100 border border-slate-200 text-[#123B60] font-bold text-xs rounded-md">
                  {websiteContent.contact.socialHandle}
                </span>
              </div>
            </div>

            {/* Quick Inquiry / Recruitment CTA Box */}
            <div className="lg:col-span-6 bg-gradient-to-br from-[#123B60] to-[#0A2239] rounded-3xl p-8 sm:p-10 text-white shadow-2xl">
              <span className="text-xs font-bold text-[#F59A16] uppercase tracking-wider">Recruitment 2026-2027</span>
              <h3 className="text-2xl sm:text-3xl font-black text-white mt-1">Ready to Join the Chapter?</h3>
              <p className="text-xs text-slate-200 mt-3 leading-relaxed">
                Step into a community dedicated to real engineering excellence, advanced materials, and career leadership.
              </p>

              <div className="mt-8 space-y-4">
                <button
                  onClick={onNavigateToJoin}
                  className="w-full py-4 bg-[#F59A16] hover:bg-[#D47F0A] text-white font-bold rounded-xl shadow-lg transition flex items-center justify-center gap-2 text-sm"
                >
                  Apply For Membership
                  <ArrowRight className="w-4 h-4" />
                </button>
                <button
                  onClick={onNavigateToDashboard}
                  className="w-full py-3 bg-white/10 hover:bg-white/20 text-white font-semibold rounded-xl border border-white/20 transition flex items-center justify-center gap-2 text-xs"
                >
                  <ShieldCheck className="w-4 h-4 text-[#F59A16]" />
                  Internal Leadership Login
                </button>
              </div>

              <div className="mt-6 text-center text-[11px] text-slate-400">
                Simulated local deployment • Faculty of Engineering, Cairo University
              </div>
            </div>
          </div>

        </div>
      </section>

      {/* Footer */}
      <footer className="bg-[#0A2239] text-white py-12 border-t border-white/10 text-xs">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex flex-col md:flex-row items-center justify-between gap-6">
            <div className="flex items-center gap-3">
              <div className="bg-white p-1 rounded-md">
                <img src="/branding/esme_logo.png" alt="ESME" className="h-8 w-auto object-contain" />
              </div>
              <div>
                <div className="font-bold text-white text-sm">Egyptian Society of Materials Engineers</div>
                <div className="text-slate-400 text-xs">Cairo University Student Chapter</div>
              </div>
            </div>

            <div className="text-center md:text-right text-slate-400 space-y-1">
              <div>© 2026 ESME CU Chapter. All Rights Reserved.</div>
              <div className="text-[11px] text-[#F59A16]">Primary Administrator: Kareem Tamer (Super Admin)</div>
            </div>
          </div>
        </div>
      </footer>

    </div>
  );
};
