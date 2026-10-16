import React, { useState } from 'react';
import {
  motion,
  AnimatePresence,
  useMotionValue,
  useReducedMotion,
  useSpring,
  useTransform,
} from 'motion/react';
import {
  Menu,
  X,
  ChevronRight,
  BookOpen,
  CheckCircle2,
  ArrowRight,
  ShieldCheck,
  Sparkles,
  BarChart3,
  Phone,
  Mail,
  MapPin,
  Flame,
} from 'lucide-react';
import { useApp } from '../context/AppContext';
import { HISTORICAL_MILESTONES, APPRECIATION_PROFILES, HISTORICAL_SOCIAL_INSIGHTS } from '../data/historyData';
import {
  AnimatedNumber,
  MagneticButton,
  Reveal,
  StaggerGroup,
  StaggerItem,
  WordReveal,
  fadeIn,
  growX,
  groupItemScale,
  scaleIn,
  staggerGroup,
  transitions,
  usePremiumMotion,
} from '../motion';

interface PublicWebsiteProps {
  onNavigateToDashboard: () => void;
  onNavigateToJoin: () => void;
}

const heroContainer = staggerGroup(0.09, 0.15);
const heroItem = {
  hidden: { opacity: 0, y: 18 },
  visible: { opacity: 1, y: 0, transition: { duration: 0.55, ease: [0.22, 1, 0.36, 1] as const } },
};

const SectionIntro: React.FC<{
  eyebrow: string;
  title: React.ReactNode;
  subtitle?: React.ReactNode;
  dark?: boolean;
  divider?: boolean;
}> = ({ eyebrow, title, subtitle, dark, divider = true }) => (
  <Reveal className="text-center max-w-3xl mx-auto mb-14">
    <span className={`text-xs font-bold uppercase tracking-widest text-[#F59A16] ${dark ? 'font-extrabold' : ''}`}>
      {eyebrow}
    </span>
    <h2 className={`text-3xl sm:text-4xl font-extrabold mt-2 ${dark ? 'text-white' : 'text-[#123B60]'}`}>
      {title}
    </h2>
    {subtitle && (
      <p className={`text-xs mt-2 leading-relaxed ${dark ? 'text-slate-300' : 'text-slate-500'}`}>{subtitle}</p>
    )}
    {divider && (
      <motion.div
        className="w-16 h-1 bg-[#F59A16] mx-auto mt-4 rounded-full origin-center"
        variants={growX}
      />
    )}
  </Reveal>
);

const ScrollIndicator: React.FC = () => {
  const reduced = useReducedMotion();
  return (
    <motion.div
      className="absolute bottom-5 left-1/2 z-10 -translate-x-1/2 flex flex-col items-center gap-2 text-slate-300"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ delay: 1.6, duration: 0.6 }}
      aria-hidden="true"
    >
      <div className="w-5 h-8 rounded-full border-2 border-slate-400/60 flex justify-center pt-1.5">
        <motion.span
          className="w-1 h-1.5 rounded-full bg-[#F59A16]"
          animate={reduced ? undefined : { y: [0, 10], opacity: [1, 0] }}
          transition={{ duration: 1.4, repeat: Infinity, ease: 'easeInOut' }}
        />
      </div>
      <span className="text-[9px] uppercase tracking-[0.2em] font-semibold">Scroll</span>
    </motion.div>
  );
};

const EngineeringBackdrop: React.FC = () => {
  const reduced = useReducedMotion();
  const paths = [
    'M -20 340 L 180 340 L 260 220 L 460 220',
    'M 820 40 L 640 40 L 560 160 L 380 160',
    'M 1000 300 L 860 300 L 800 380 L 640 380',
  ];
  const nodes = [
    { cx: 180, cy: 340, r: 5 },
    { cx: 260, cy: 220, r: 6 },
    { cx: 460, cy: 220, r: 4 },
    { cx: 640, cy: 40, r: 5 },
    { cx: 560, cy: 160, r: 6 },
    { cx: 380, cy: 160, r: 4 },
    { cx: 860, cy: 300, r: 5 },
    { cx: 800, cy: 380, r: 6 },
  ];
  return (
    <svg
      className="absolute inset-0 w-full h-full pointer-events-none"
      viewBox="0 0 1100 440"
      preserveAspectRatio="xMidYMid slice"
      aria-hidden="true"
    >
      {paths.map((d, i) => (
        <motion.path
          key={i}
          d={d}
          fill="none"
          stroke="rgba(245,154,22,0.18)"
          strokeWidth={1.2}
          initial={reduced ? undefined : { pathLength: 0, opacity: 0 }}
          animate={reduced ? { pathLength: 1, opacity: 1 } : { pathLength: 1, opacity: 1 }}
          transition={{ duration: 1.4, delay: 0.6 + i * 0.25, ease: 'easeOut' }}
        />
      ))}
      {nodes.map((n, i) => (
        <motion.circle
          key={i}
          cx={n.cx}
          cy={n.cy}
          r={n.r}
          fill="none"
          stroke="rgba(255,255,255,0.16)"
          strokeWidth={1}
          initial={reduced ? undefined : { scale: 0, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          transition={{ duration: 0.5, delay: 1.1 + i * 0.12, ease: [0.22, 1, 0.36, 1] }}
          style={{ transformOrigin: `${n.cx}px ${n.cy}px` }}
        />
      ))}
    </svg>
  );
};

export const PublicWebsite: React.FC<PublicWebsiteProps> = ({
  onNavigateToDashboard,
  onNavigateToJoin
}) => {
  const { websiteContent, seasonEvents, committees } = useApp();
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [activeHistoryTab, setActiveHistoryTab] = useState(0);
  const premiumMotion = usePremiumMotion();

  const pointerX = useMotionValue(0);
  const pointerY = useMotionValue(0);
  const springX = useSpring(pointerX, { stiffness: 55, damping: 18, mass: 0.6 });
  const springY = useSpring(pointerY, { stiffness: 55, damping: 18, mass: 0.6 });

  const blobOrangeX = useTransform(springX, [-1, 1], [28, -28]);
  const blobOrangeY = useTransform(springY, [-1, 1], [18, -18]);
  const blobBlueX = useTransform(springX, [-1, 1], [-18, 18]);
  const blobBlueY = useTransform(springY, [-1, 1], [-12, 12]);
  const gridX = useTransform(springX, [-1, 1], [8, -8]);
  const gridY = useTransform(springY, [-1, 1], [5, -5]);
  const cardX = useTransform(springX, [-1, 1], [-10, 10]);
  const cardY = useTransform(springY, [-1, 1], [-7, 7]);

  const handleHeroPointer = (e: React.MouseEvent<HTMLElement>) => {
    if (!premiumMotion) return;
    const rect = e.currentTarget.getBoundingClientRect();
    pointerX.set(((e.clientX - rect.left) / rect.width) * 2 - 1);
    pointerY.set(((e.clientY - rect.top) / rect.height) * 2 - 1);
  };

  const resetHeroPointer = () => {
    pointerX.set(0);
    pointerY.set(0);
  };

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
            <motion.button
              onClick={onNavigateToDashboard}
              className="text-xs bg-[#F59A16] hover:bg-[#D47F0A] text-white px-3 py-1 rounded font-semibold shadow-sm"
              whileHover={{ scale: 1.04 }}
              whileTap={{ scale: 0.96 }}
              transition={transitions.micro}
            >
              Portal Login &rarr;
            </motion.button>
          </div>
        </div>
      </div>

      {/* Main Sticky Navbar */}
      <nav className="sticky top-0 z-50 bg-[#123B60]/95 backdrop-blur-md border-b border-white/10 text-white shadow-lg">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex items-center justify-between h-20">
            {/* Logo */}
            <motion.a
              href="#home"
              className="flex items-center gap-3 group"
              initial={{ opacity: 0, x: -16 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ duration: 0.5, ease: [0.22, 1, 0.36, 1], delay: 0.1 }}
              whileHover={{ scale: 1.02 }}
            >
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
            </motion.a>

            {/* Desktop Navigation Links */}
            <div className="hidden xl:flex items-center space-x-1">
              {navLinks.map((link, i) => (
                <motion.a
                  key={link.label}
                  href={link.href}
                  initial={{ opacity: 0, y: -8 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: 0.35, delay: 0.2 + i * 0.04, ease: [0.22, 1, 0.36, 1] }}
                  className="group relative px-3 py-1.5 rounded text-xs font-semibold text-slate-200 hover:text-white"
                >
                  {link.label}
                  <span className="absolute left-3 right-3 bottom-1 h-[2px] origin-left scale-x-0 bg-[#F59A16] rounded-full transition-transform duration-200 ease-out group-hover:scale-x-100" />
                </motion.a>
              ))}
            </div>

            {/* Right CTAs */}
            <div className="hidden lg:flex items-center space-x-3">
              <motion.button
                onClick={onNavigateToDashboard}
                className="px-4 py-2 text-xs font-bold text-white border border-[#F59A16] rounded-lg hover:bg-[#F59A16]/20 flex items-center gap-1.5"
                initial={{ opacity: 0, y: -8 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.35, delay: 0.4 }}
                whileHover={{ y: -1 }}
                whileTap={{ scale: 0.97 }}
              >
                <ShieldCheck className="w-3.5 h-3.5 text-[#F59A16]" />
                Internal System
              </motion.button>
              <MagneticButton
                onClick={onNavigateToJoin}
                strength={0.18}
                className="px-5 py-2 text-xs font-bold text-white bg-[#F59A16] hover:bg-[#D47F0A] rounded-lg shadow-md shadow-[#F59A16]/20 flex items-center gap-1.5"
                initial={{ opacity: 0, y: -8 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.35, delay: 0.45 }}
              >
                Join Chapter
                <ArrowRight className="w-3.5 h-3.5" />
              </MagneticButton>
            </div>

            {/* Mobile menu button */}
            <div className="xl:hidden flex items-center gap-2">
              <button
                onClick={onNavigateToDashboard}
                className="px-3 py-1.5 text-xs font-bold text-white bg-[#F59A16] rounded-md"
              >
                Login
              </button>
              <motion.button
                onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
                className="p-2 rounded-md text-slate-300 hover:text-white hover:bg-white/10"
                whileTap={{ scale: 0.9 }}
                aria-expanded={mobileMenuOpen}
                aria-label="Toggle navigation menu"
              >
                <AnimatePresence mode="wait" initial={false}>
                  <motion.span
                    key={mobileMenuOpen ? 'close' : 'open'}
                    initial={{ rotate: -60, opacity: 0 }}
                    animate={{ rotate: 0, opacity: 1 }}
                    exit={{ rotate: 60, opacity: 0 }}
                    transition={{ duration: 0.15 }}
                    className="block"
                  >
                    {mobileMenuOpen ? <X className="w-6 h-6" /> : <Menu className="w-6 h-6" />}
                  </motion.span>
                </AnimatePresence>
              </motion.button>
            </div>
          </div>
        </div>

        {/* Mobile menu dropdown */}
        <AnimatePresence>
          {mobileMenuOpen && (
            <motion.div
              initial={{ height: 0, opacity: 0 }}
              animate={{ height: 'auto', opacity: 1 }}
              exit={{ height: 0, opacity: 0 }}
              transition={{ duration: 0.3, ease: [0.22, 1, 0.36, 1] }}
              className="overflow-hidden xl:hidden bg-[#0A2239] border-b border-white/10"
            >
              <div className="px-4 pt-2 pb-6 space-y-2">
                {navLinks.map((link, i) => (
                  <motion.a
                    key={link.label}
                    href={link.href}
                    onClick={() => setMobileMenuOpen(false)}
                    initial={{ opacity: 0, x: -14 }}
                    animate={{ opacity: 1, x: 0 }}
                    transition={{ delay: 0.05 + i * 0.04, duration: 0.25 }}
                    className="block px-3 py-2 rounded-md text-sm font-medium text-slate-200 hover:text-white hover:bg-white/10 transition-colors"
                  >
                    {link.label}
                  </motion.a>
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
            </motion.div>
          )}
        </AnimatePresence>
      </nav>

      {/* Hero Section */}
      <section
        id="home"
        className="relative overflow-hidden bg-gradient-to-b from-[#123B60] via-[#0E2F4D] to-[#0A2239] text-white pt-16 pb-28"
        onMouseMove={handleHeroPointer}
        onMouseLeave={resetHeroPointer}
      >
        {/* Subtle engineering decorative grid */}
        <motion.div className="absolute inset-[-24px] bg-grid-pattern-dark opacity-15 pointer-events-none" style={{ x: gridX, y: gridY }} />
        <motion.div
          className="absolute -top-32 -right-32 w-96 h-96 bg-[#F59A16]/10 rounded-full blur-3xl pointer-events-none"
          style={{ x: blobOrangeX, y: blobOrangeY }}
        />
        <motion.div
          className="absolute bottom-0 -left-20 w-80 h-80 bg-[#1D5485]/20 rounded-full blur-2xl pointer-events-none"
          style={{ x: blobBlueX, y: blobBlueY }}
        />
        <EngineeringBackdrop />

        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 relative z-10">
          <motion.div
            className="grid grid-cols-1 lg:grid-cols-12 gap-12 items-center"
            variants={heroContainer}
            initial="hidden"
            animate="visible"
          >

            {/* Left Column Text */}
            <div className="lg:col-span-7 space-y-6">
              <motion.div
                variants={heroItem}
                className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-white/10 border border-white/20 text-[#F59A16] text-xs font-semibold backdrop-blur-sm"
              >
                <Sparkles className="w-3.5 h-3.5" />
                <span>{websiteContent.hero.badge}</span>
              </motion.div>

              <h1 className="text-4xl sm:text-5xl lg:text-6xl font-black tracking-tight text-white leading-tight">
                <WordReveal text={websiteContent.hero.headline} step={0.07} delayChildren={0.25} />
              </h1>

              <motion.p
                variants={heroItem}
                className="text-lg sm:text-xl text-slate-200 leading-relaxed font-light border-l-4 border-[#F59A16] pl-4"
              >
                {websiteContent.hero.supportingMessage}
              </motion.p>

              {/* Motto highlight */}
              <motion.div
                variants={heroItem}
                className="inline-block bg-[#F59A16]/15 border border-[#F59A16]/30 px-4 py-2 rounded-lg text-sm text-[#F59A16] font-bold"
              >
                Chapter Core Motto: <span className="underline uppercase tracking-wider">BE POSITIVE VALUABLE</span>
              </motion.div>

              {/* CTAs */}
              <motion.div variants={heroItem} className="pt-4 flex flex-wrap items-center gap-4">
                <MagneticButton
                  onClick={onNavigateToDashboard}
                  className="px-7 py-3.5 bg-[#F59A16] hover:bg-[#D47F0A] text-white font-bold rounded-xl shadow-xl shadow-[#F59A16]/25 flex items-center gap-2 group text-sm"
                >
                  <ShieldCheck className="w-4 h-4 transition group-hover:scale-110" />
                  {websiteContent.hero.ctaPrimary}
                </MagneticButton>
                <motion.button
                  onClick={onNavigateToJoin}
                  className="px-7 py-3.5 bg-white/10 hover:bg-white/20 text-white font-semibold rounded-xl border border-white/20 flex items-center gap-2 text-sm backdrop-blur-sm"
                  whileHover={{ y: -2 }}
                  whileTap={{ scale: 0.97 }}
                  transition={transitions.micro}
                >
                  {websiteContent.hero.ctaSecondary}
                  <ChevronRight className="w-4 h-4" />
                </motion.button>
              </motion.div>

              {/* Quick credibility counters */}
              <motion.div variants={heroItem} className="pt-8 grid grid-cols-3 gap-6 border-t border-white/15">
                <div>
                  <div className="text-2xl sm:text-3xl font-extrabold text-[#F59A16]">
                    <AnimatedNumber value={2009} format={(n) => String(Math.round(n))} />
                  </div>
                  <div className="text-xs text-slate-300">Society Founded</div>
                </div>
                <div>
                  <div className="text-2xl sm:text-3xl font-extrabold text-white">
                    <AnimatedNumber value={2015} format={(n) => String(Math.round(n))} />
                  </div>
                  <div className="text-xs text-slate-300">Cairo Chapter Active</div>
                </div>
                <div>
                  <div className="text-2xl sm:text-3xl font-extrabold text-[#F59A16]">
                    <AnimatedNumber value={4} /> Major
                  </div>
                  <div className="text-xs text-slate-300">Annual Summits</div>
                </div>
              </motion.div>
            </div>

            {/* Right Column Official Brand Imagery */}
            <motion.div className="lg:col-span-5 space-y-4" style={{ x: cardX, y: cardY }} variants={scaleIn}>
              <div className="relative rounded-2xl overflow-hidden border-2 border-white/20 shadow-2xl bg-[#0A2239] group">
                <img
                  src="/branding/esme_team_celebration.png"
                  alt="ESME CU Student Chapter Celebration"
                  className="w-full h-80 object-cover object-center filter saturate-105 transition-transform duration-700 ease-out group-hover:scale-[1.04]"
                />
                <div className="absolute inset-0 bg-gradient-to-t from-[#0A2239] via-transparent to-transparent"></div>
                <div className="absolute bottom-4 left-4 right-4 text-white">
                  <span className="px-2.5 py-1 bg-[#F59A16] text-[10px] font-black uppercase rounded tracking-wider">Official 2026-2027 Vision Launch</span>
                  <p className="text-xs text-slate-200 mt-1">Zerust Presentation & ESME-Cairo University General Assembly</p>
                </div>
              </div>

              {/* Secondary recruitment badge */}
              <motion.div
                className="p-4 rounded-xl bg-white/10 backdrop-blur-md border border-white/15 flex items-center gap-4 hover:bg-white/15 transition-colors"
                whileHover={{ y: -3 }}
                transition={transitions.standard}
              >
                <div className="w-12 h-12 rounded-lg bg-[#F59A16] flex items-center justify-center shrink-0">
                  <Flame className="w-6 h-6 text-white" />
                </div>
                <div className="text-xs">
                  <div className="font-bold text-white text-sm">Empowering Engineers</div>
                  <div className="text-slate-300">Materials Science • NDT Inspection • AI Systems • Industry 4.0</div>
                </div>
              </motion.div>
            </motion.div>

          </motion.div>
        </div>

        <ScrollIndicator />
      </section>

      {/* About Section */}
      <section id="about" className="py-20 bg-white border-b border-slate-200 relative">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <SectionIntro
            eyebrow="Authoritative Profile"
            title={websiteContent.about.title}
          />

          <div className="grid grid-cols-1 lg:grid-cols-12 gap-10 items-start">
            <div className="lg:col-span-7 space-y-6 text-slate-700 leading-relaxed">
              <Reveal delay={0.05}>
                <div className="p-6 bg-[#FDFBF7] rounded-2xl border border-slate-200 shadow-sm hover:shadow-md hover:border-[#123B60]/20 transition-all duration-300">
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
              </Reveal>

              <Reveal delay={0.15}>
                <div className="p-6 bg-slate-50 rounded-2xl border border-slate-200 hover:border-slate-300 transition-colors duration-300">
                  <h3 className="text-lg font-bold text-[#123B60] mb-2">Chapter Purpose & Objectives</h3>
                  <p className="text-sm text-slate-600 mb-4">{websiteContent.about.purpose}</p>
                  <StaggerGroup className="space-y-2.5" step={0.07} amount={0.3}>
                    {websiteContent.about.objectives.map((obj, i) => (
                      <StaggerItem key={i}>
                        <div className="flex items-start gap-2.5 text-xs text-slate-700">
                          <div className="w-5 h-5 rounded-full bg-[#123B60] text-white flex items-center justify-center shrink-0 text-[10px] font-bold mt-0.5">
                            {i + 1}
                          </div>
                          <span>{obj}</span>
                        </div>
                      </StaggerItem>
                    ))}
                  </StaggerGroup>
                </div>
              </Reveal>
            </div>

            <div className="lg:col-span-5 space-y-4">
              <Reveal delay={0.1}>
                <div className="p-6 bg-gradient-to-br from-[#123B60] to-[#0A2239] rounded-2xl text-white shadow-xl hover:shadow-2xl transition-shadow duration-300">
                  <h3 className="text-lg font-bold text-[#F59A16] mb-3">Core Chapter Values</h3>
                  <StaggerGroup className="space-y-3" step={0.08} amount={0.25}>
                    {websiteContent.about.values.map((val, idx) => (
                      <StaggerItem key={idx}>
                        <div className="flex items-center justify-between p-3 rounded-lg bg-white/10 border border-white/10 text-xs font-semibold hover:bg-white/15 hover:translate-x-1 transition-all duration-200">
                          <span>{val}</span>
                          <CheckCircle2 className="w-4 h-4 text-[#F59A16]" />
                        </div>
                      </StaggerItem>
                    ))}
                  </StaggerGroup>
                </div>
              </Reveal>

              {/* Campus monument photo from PDF xref_585 */}
              <Reveal delay={0.2}>
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
              </Reveal>
            </div>
          </div>
        </div>
      </section>

      {/* Official Vision 2026-2027 Section */}
      <section id="vision" className="py-20 bg-slate-900 text-white relative overflow-hidden">
        <div className="absolute inset-0 bg-grid-pattern-dark opacity-10 pointer-events-none"></div>
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 relative z-10">

          <div className="text-center max-w-4xl mx-auto mb-14">
            <Reveal>
              <span className="text-xs font-extrabold uppercase tracking-widest text-[#F59A16]">Strategic Plan 2026–2027</span>
              <h2 className="text-3xl sm:text-4xl font-black mt-2 tracking-tight">
                {websiteContent.vision2027.headline}
              </h2>
            </Reveal>
            <Reveal delay={0.15}>
              <blockquote className="text-xl sm:text-2xl font-serif italic text-[#F59A16] mt-4 border-y border-white/10 py-4 max-w-3xl mx-auto">
                {websiteContent.vision2027.quote}
              </blockquote>
            </Reveal>
            <Reveal delay={0.25}>
              <p className="text-sm text-slate-300 mt-4 leading-relaxed font-light">
                {websiteContent.vision2027.description}
              </p>
            </Reveal>
          </div>

          {/* 4 Strategic Focus Areas */}
          <StaggerGroup className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6" step={0.1}>
            {websiteContent.vision2027.pillars.map((pillar, idx) => (
              <StaggerItem key={idx} variants={groupItemScale} className="h-full">
                <motion.div
                  className="bg-white/5 border border-white/10 rounded-2xl p-6 hover:bg-white/10 backdrop-blur-sm flex flex-col justify-between h-full hover:border-[#F59A16]/40 transition-colors duration-300"
                  whileHover={{ y: -5 }}
                  transition={transitions.standard}
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
                </motion.div>
              </StaggerItem>
            ))}
          </StaggerGroup>

        </div>
      </section>

      {/* Historical Milestones (2015 - 2023) */}
      <section id="history" className="py-20 bg-white border-b border-slate-200">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">

          <SectionIntro
            eyebrow="Visual Timeline"
            title="Verified Chapter History (2015–2023)"
            subtitle="Documented milestones from foundation through safety training, field trips, and EISC conferences."
          />

          {/* Historical Period Tabs */}
          <Reveal className="flex flex-wrap items-center justify-center gap-2 mb-10" amount={0.5}>
            {HISTORICAL_MILESTONES.map((m, idx) => {
              const isActive = activeHistoryTab === idx;
              return (
                <button
                  key={m.period}
                  onClick={() => setActiveHistoryTab(idx)}
                  className={`relative px-4 py-2.5 rounded-xl text-xs font-bold flex items-center gap-2 overflow-hidden transition-colors duration-200 ${
                    isActive ? 'text-white' : 'bg-slate-100 text-slate-700 hover:bg-slate-200'
                  }`}
                >
                  {isActive && (
                    <motion.span
                      layoutId="history-tab-bg"
                      className="absolute inset-0 bg-[#123B60] rounded-xl shadow-md"
                      transition={{ type: 'spring', stiffness: 380, damping: 32 }}
                    />
                  )}
                  <span className="relative z-10">{m.period}</span>
                  <span className={`relative z-10 text-[10px] px-2 py-0.5 rounded-full transition-colors duration-200 ${
                    isActive ? 'bg-[#F59A16] text-white' : 'bg-slate-300 text-slate-800'
                  }`}>
                    {m.activities.length} Events
                  </span>
                </button>
              );
            })}
          </Reveal>

          {/* Active Period Detail */}
          <AnimatePresence mode="wait">
            {HISTORICAL_MILESTONES[activeHistoryTab] && (
              <motion.div
                key={activeHistoryTab}
                initial={{ opacity: 0, y: 18 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -12 }}
                transition={{ duration: 0.35, ease: [0.22, 1, 0.36, 1] }}
                className="bg-[#FDFBF7] border border-slate-200 rounded-2xl p-6 sm:p-8 shadow-sm"
              >
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
                      <motion.div
                        className="space-y-2"
                        variants={staggerGroup(0.06, 0.1)}
                        initial="hidden"
                        animate="visible"
                      >
                        {HISTORICAL_MILESTONES[activeHistoryTab].activities.map((act, i) => (
                          <motion.div
                            key={i}
                            variants={{ hidden: { opacity: 0, x: -16 }, visible: { opacity: 1, x: 0, transition: { duration: 0.4, ease: [0.22, 1, 0.36, 1] } } }}
                            className="p-3 bg-white rounded-xl border border-slate-200 flex items-start justify-between gap-3 text-xs hover:border-[#123B60]/30 hover:shadow-sm transition-all duration-200"
                          >
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
                          </motion.div>
                        ))}
                      </motion.div>
                    </div>
                  </div>

                  <div className="lg:col-span-5 space-y-4">
                    {HISTORICAL_MILESTONES[activeHistoryTab].image && (
                      <div className="rounded-2xl overflow-hidden border border-slate-200 shadow-md group">
                        <img
                          src={HISTORICAL_MILESTONES[activeHistoryTab].image}
                          alt={HISTORICAL_MILESTONES[activeHistoryTab].period}
                          className="w-full h-64 object-cover object-top transition-transform duration-700 ease-out group-hover:scale-105"
                        />
                        <div className="p-3 bg-white text-[11px] text-slate-500 border-t border-slate-200">
                          Official Historical Archive • Cairo University Student Chapter Record
                        </div>
                      </div>
                    )}
                  </div>

                </div>
              </motion.div>
            )}
          </AnimatePresence>

        </div>
      </section>

      {/* Academic Appreciation and Alumni Section */}
      <section id="appreciation" className="py-20 bg-slate-50 border-b border-slate-200">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">

          <SectionIntro
            eyebrow="Alumni & Faculty Honour"
            title="Academic Appreciation"
            subtitle='"ESME Cairo proudly affirms its role as an incubator for excellence and leadership in engineering, celebrating former members who now represent the pinnacle of distinction as Doctors and Teaching Assistants at the Faculty."'
          />

          <StaggerGroup className="grid grid-cols-1 md:grid-cols-3 gap-8" step={0.12}>
            {APPRECIATION_PROFILES.map((prof) => (
              <StaggerItem key={prof.id} variants={groupItemScale} className="h-full">
                <motion.div
                  className="bg-white rounded-2xl border border-slate-200 shadow-sm hover:shadow-lg hover:border-[#123B60]/20 transition-shadow p-6 flex flex-col justify-between h-full"
                  whileHover={{ y: -6 }}
                  transition={transitions.standard}
                >
                  <div>
                    <div className="w-full h-56 rounded-xl overflow-hidden border-2 border-slate-100 shadow-inner mb-5 bg-slate-100 group">
                      <img
                        src={prof.image}
                        alt={prof.name}
                        className="w-full h-full object-cover object-top transition-transform duration-700 ease-out group-hover:scale-105"
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
                </motion.div>
              </StaggerItem>
            ))}
          </StaggerGroup>

          {/* Board to Year 2025/2026 Poster Gallery */}
          <Reveal className="mt-16" amount={0.15}>
            <div className="bg-[#123B60] rounded-2xl p-6 sm:p-8 text-white relative overflow-hidden hover:shadow-2xl transition-shadow duration-300">
              <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 items-center">
                <div className="lg:col-span-5 space-y-4">
                  <span className="px-3 py-1 bg-[#F59A16] text-[10px] font-black uppercase rounded tracking-wider inline-block">Historical Board Roster</span>
                  <h3 className="text-2xl font-bold text-white">Board to Year 25/26 Leadership</h3>
                  <p className="text-xs text-slate-300 leading-relaxed">
                    Preserving the official roster from the recruitment archive: President Ahmed Abbas, Vice President Omar Mohamed, Secretary Nada Yehia, along with HR, PR, OC, TE, TR, and MM directors.
                  </p>
                  <div className="text-xs text-[#F59A16] font-semibold">
                    Official archive source: doc_p8_img0_732.png
                  </div>
                </div>
                <div className="lg:col-span-7">
                  <div className="rounded-xl overflow-hidden border border-white/20 shadow-2xl group">
                    <img
                      src="/branding/board_poster_2025_2026.png"
                      alt="Board to Year 25/26"
                      className="w-full h-auto object-cover transition-transform duration-700 ease-out group-hover:scale-[1.03]"
                    />
                  </div>
                </div>
              </div>
            </div>
          </Reveal>

        </div>
      </section>

      {/* Committees Section */}
      <section id="committees" className="py-20 bg-white border-b border-slate-200">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">

          <SectionIntro
            eyebrow="Organizational Pillars"
            title="Official Chapter Committees"
            subtitle="The operational engines driving workshops, design templates, field marketing, and technical publications."
          />

          <StaggerGroup className="grid grid-cols-1 md:grid-cols-2 gap-8" step={0.12}>
            {committees.map((comm) => (
              <StaggerItem key={comm.id} variants={groupItemScale}>
                <motion.div
                  className="bg-[#FDFBF7] border border-slate-200 rounded-2xl p-6 sm:p-8 hover:shadow-lg hover:border-[#123B60]/25 transition-shadow flex flex-col justify-between"
                  whileHover={{ y: -4 }}
                  transition={transitions.standard}
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
                          <span key={idx} className="px-2.5 py-1 bg-white border border-slate-200 text-slate-700 text-[11px] rounded-md font-medium hover:border-[#F59A16]/60 hover:text-[#123B60] transition-colors cursor-default">
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
                </motion.div>
              </StaggerItem>
            ))}
          </StaggerGroup>

        </div>
      </section>

      {/* Events & Season Calendar */}
      <section id="events" className="py-20 bg-slate-50 border-b border-slate-200">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">

          <SectionIntro
            eyebrow="Season Roadmap"
            title="Master Calendar & Events (2026–2027)"
            subtitle="4 major summits, 10 specialized workshops, and 32 professional sessions planned."
          />

          <StaggerGroup className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6" step={0.09}>
            {seasonEvents.filter(e => e.category === 'Major Event').map((evt) => (
              <StaggerItem key={evt.id} variants={groupItemScale} className="h-full">
                <motion.div
                  className="bg-white border-2 border-[#123B60]/10 rounded-2xl p-6 shadow-sm hover:shadow-md hover:border-[#F59A16]/40 transition-colors flex flex-col justify-between h-full"
                  whileHover={{ y: -5 }}
                  transition={transitions.standard}
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
                </motion.div>
              </StaggerItem>
            ))}
          </StaggerGroup>

          {/* Workshop Track Summary from Vision PDF */}
          <Reveal className="mt-12" amount={0.1}>
            <div className="bg-white rounded-2xl p-6 sm:p-8 border border-slate-200">
              <h3 className="text-lg font-bold text-[#123B60] mb-4 flex items-center gap-2">
                <BookOpen className="w-5 h-5 text-[#F59A16]" />
                Workshops & Capability Building Tracks (Feb–Jul 2027)
              </h3>
              <StaggerGroup className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-4 text-xs" step={0.08} amount={0.15}>
                {[
                  { when: 'Feb 2027 • 2-3 Days', name: 'NDT / Inspection', desc: 'Ultrasonic, Radiography & Magnetic Particle.' },
                  { when: 'Mar 2027 • 2 Days', name: 'Materials Testing', desc: 'Tensile, impact, hardness & metallography.' },
                  { when: 'Apr 2027 • 3 Days', name: 'Automation / AI', desc: 'Generative & Agentic AI in engineering.' },
                  { when: 'May 2027 • 2 Days', name: 'Sustainability', desc: 'Green metallurgy & circular materials.' },
                  { when: 'Jun 2027 • 3 Days', name: 'ANSYS & SolidWorks', desc: 'FEA simulation and structural design.' },
                ].map((w) => (
                  <StaggerItem key={w.name} variants={fadeIn}>
                    <motion.div
                      className="p-4 bg-slate-50 rounded-xl border border-slate-200 h-full hover:bg-white hover:border-[#123B60]/30 hover:shadow-sm transition-all duration-200"
                      whileHover={{ y: -3 }}
                    >
                      <span className="text-[10px] font-bold text-[#F59A16] uppercase">{w.when}</span>
                      <h4 className="font-bold text-[#123B60] mt-1">{w.name}</h4>
                      <p className="text-slate-500 text-[11px] mt-1">{w.desc}</p>
                    </motion.div>
                  </StaggerItem>
                ))}
              </StaggerGroup>
            </div>
          </Reveal>

        </div>
      </section>

      {/* Scientific Magazine Section */}
      <section id="magazine" className="py-20 bg-white border-b border-slate-200">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">

          <SectionIntro
            eyebrow="Quarterly Publication Engine"
            title="ESME Scientific Magazine"
            subtitle="A company-academic publication engine linking real science, industry, and emerging technology."
          />

          <StaggerGroup className="grid grid-cols-1 md:grid-cols-3 gap-8" step={0.12}>
            {[
              {
                issue: 'Issue 1 • December 2026', badge: 'bg-[#F59A16]', title: 'Materials & Manufacturing',
                desc: 'Focusing on advanced alloy development, heat treatment protocols, and modern steelmaking innovations.',
                status: 'In Preparation', statusCls: 'text-amber-600', plan: 'Planned', border: 'border-2 border-[#123B60]/20',
                template: 'Template 1: Classic Academic Research Layout',
              },
              {
                issue: 'Issue 2 • March 2027', badge: 'bg-[#123B60]', title: 'Inspection & Reliability',
                desc: 'Dedicated to QA/QC frameworks, ultrasonic flaw identification, and asset integrity management.',
                status: 'Planned (Q2)', statusCls: 'text-slate-600', plan: 'Planned', border: 'border border-slate-200',
                template: 'Template 2: Modern Visual Infographics',
              },
              {
                issue: 'Issue 3 • June 2027', badge: 'bg-[#123B60]', title: 'Smart Materials & Industry 4.0',
                desc: 'Examining self-healing coatings, shape memory alloys, and generative AI in generative design.',
                status: 'Planned (Q3)', statusCls: 'text-slate-600', plan: 'Planned', border: 'border border-slate-200',
                template: 'Template 3: Interactive Quick Topics & Interviews',
              },
            ].map((mag) => (
              <StaggerItem key={mag.issue} variants={groupItemScale} className="h-full">
                <motion.div
                  className={`p-6 bg-[#FDFBF7] rounded-2xl ${mag.border} flex flex-col justify-between h-full hover:shadow-lg transition-shadow`}
                  whileHover={{ y: -5 }}
                  transition={transitions.standard}
                >
                  <div>
                    <span className={`${mag.badge} px-2.5 py-1 rounded text-white text-[10px] font-bold uppercase`}>{mag.issue}</span>
                    <h3 className="text-xl font-bold text-[#123B60] mt-3">{mag.title}</h3>
                    <p className="text-xs text-slate-600 mt-2 leading-relaxed">{mag.desc}</p>
                    <div className="mt-4 p-3 bg-white rounded-xl border border-slate-200 text-xs text-slate-500 space-y-1">
                      <div>Status: <strong className={mag.statusCls}>{mag.status}</strong></div>
                      <div>Target Partners: <strong className="text-slate-700">3-5 Industrial Contributors</strong></div>
                    </div>
                  </div>
                  <div className="mt-6 pt-4 border-t border-slate-200 text-[11px] text-slate-400">
                    {mag.template}
                  </div>
                </motion.div>
              </StaggerItem>
            ))}
          </StaggerGroup>

        </div>
      </section>

      {/* Meta Insights Report Snapshot (October 2026) */}
      <section id="insights" className="py-20 bg-slate-900 text-white relative">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">

          <div className="text-center max-w-3xl mx-auto mb-14">
            <Reveal>
              <span className="px-3 py-1 rounded-full bg-[#F59A16]/20 border border-[#F59A16] text-[#F59A16] text-xs font-bold inline-flex items-center gap-1.5">
                <BarChart3 className="w-3 h-3" />
                Archived Snapshot • {HISTORICAL_SOCIAL_INSIGHTS.reportDate}
              </span>
              <h2 className="text-3xl sm:text-4xl font-extrabold text-white mt-3">
                Official Social Media Insights
              </h2>
              <p className="text-xs text-slate-300 mt-2">
                Performance analysis showing how ESME-Cairo University content drives reach among engineering students.
              </p>
              <motion.div className="w-16 h-1 bg-[#F59A16] mx-auto mt-4 rounded-full origin-center" variants={growX} />
            </Reveal>
          </div>

          {/* Metric cards */}
          <StaggerGroup className="grid grid-cols-2 md:grid-cols-4 gap-6 mb-12" step={0.1}>
            <StaggerItem variants={groupItemScale}>
              <div className="p-6 bg-white/5 border border-white/10 rounded-2xl text-center hover:border-[#F59A16]/50 hover:bg-white/10 transition-colors duration-300">
                <div className="text-3xl sm:text-4xl font-extrabold text-[#F59A16]">
                  <AnimatedNumber value={HISTORICAL_SOCIAL_INSIGHTS.totalViews} startOnView />
                </div>
                <div className="text-xs text-slate-300 mt-1 font-semibold">Total Sample Views</div>
                <div className="text-[10px] text-slate-400 mt-0.5">4 analyzed posts</div>
              </div>
            </StaggerItem>
            <StaggerItem variants={groupItemScale}>
              <div className="p-6 bg-white/5 border border-white/10 rounded-2xl text-center hover:border-white/30 hover:bg-white/10 transition-colors duration-300">
                <div className="text-3xl sm:text-4xl font-extrabold text-white">
                  <AnimatedNumber value={HISTORICAL_SOCIAL_INSIGHTS.avgViewsPerPost} startOnView />
                </div>
                <div className="text-xs text-slate-300 mt-1 font-semibold">Avg. Views / Post</div>
                <div className="text-[10px] text-slate-400 mt-0.5">Strong organic baseline</div>
              </div>
            </StaggerItem>
            <StaggerItem variants={groupItemScale}>
              <div className="p-6 bg-white/5 border border-white/10 rounded-2xl text-center hover:border-[#F59A16]/50 hover:bg-white/10 transition-colors duration-300">
                <div className="text-3xl sm:text-4xl font-extrabold text-[#F59A16]">
                  <AnimatedNumber value={HISTORICAL_SOCIAL_INSIGHTS.totalInteractions} startOnView />
                </div>
                <div className="text-xs text-slate-300 mt-1 font-semibold">Total Interactions</div>
                <div className="text-[10px] text-slate-400 mt-0.5">Reactions, clicks & shares</div>
              </div>
            </StaggerItem>
            <StaggerItem variants={groupItemScale}>
              <div className="p-6 bg-white/5 border border-white/10 rounded-2xl text-center hover:border-emerald-400/40 hover:bg-white/10 transition-colors duration-300">
                <div className="text-3xl sm:text-4xl font-extrabold text-emerald-400">{HISTORICAL_SOCIAL_INSIGHTS.highestEngagementPost.engagementRate}</div>
                <div className="text-xs text-slate-300 mt-1 font-semibold">Peak Engagement</div>
                <div className="text-[10px] text-slate-400 mt-0.5">Recruitment Open post</div>
              </div>
            </StaggerItem>
          </StaggerGroup>

          {/* Recommendations from Report */}
          <StaggerGroup className="grid grid-cols-1 md:grid-cols-3 gap-6" step={0.1}>
            {HISTORICAL_SOCIAL_INSIGHTS.strategicRecommendations.map((rec, i) => (
              <StaggerItem key={i} variants={fadeUpSoftItem}>
                <div className="p-5 bg-white/5 border border-white/10 rounded-xl h-full hover:bg-white/10 hover:border-[#F59A16]/40 transition-colors duration-300">
                  <div className="text-sm font-bold text-[#F59A16] mb-1">{rec.rule}</div>
                  <div className="text-xs text-slate-300 leading-relaxed">{rec.detail}</div>
                </div>
              </StaggerItem>
            ))}
          </StaggerGroup>

        </div>
      </section>

      {/* Contact Section */}
      <section id="contact" className="py-20 bg-white">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">

          <div className="grid grid-cols-1 lg:grid-cols-12 gap-12 items-center">
            <div className="lg:col-span-6 space-y-6">
              <Reveal>
                <span className="text-xs font-bold uppercase tracking-widest text-[#F59A16]">Connect With ESME CU</span>
                <h2 className="text-3xl sm:text-4xl font-extrabold text-[#123B60]">
                  Official Chapter Channels
                </h2>
                <p className="text-sm text-slate-600 leading-relaxed">
                  Reach out to chapter leadership, inquire about corporate sponsorship, or propose technical collaboration.
                </p>
              </Reveal>

              <StaggerGroup className="space-y-4 pt-2" step={0.1} amount={0.3}>
                <StaggerItem>
                  <motion.div className="flex items-center gap-3 text-slate-700" whileHover={{ x: 4 }} transition={transitions.micro}>
                    <div className="w-10 h-10 rounded-xl bg-[#123B60]/10 flex items-center justify-center text-[#123B60] shrink-0">
                      <Mail className="w-5 h-5" />
                    </div>
                    <div>
                      <div className="text-xs text-slate-500 font-semibold">Email</div>
                      <a href={`mailto:${websiteContent.contact.email}`} className="text-sm font-bold text-[#123B60] hover:text-[#F59A16] transition-colors">
                        {websiteContent.contact.email}
                      </a>
                    </div>
                  </motion.div>
                </StaggerItem>

                <StaggerItem>
                  <motion.div className="flex items-center gap-3 text-slate-700" whileHover={{ x: 4 }} transition={transitions.micro}>
                    <div className="w-10 h-10 rounded-xl bg-[#123B60]/10 flex items-center justify-center text-[#123B60] shrink-0">
                      <Phone className="w-5 h-5" />
                    </div>
                    <div>
                      <div className="text-xs text-slate-500 font-semibold">Phone</div>
                      <a href={`tel:${websiteContent.contact.phone}`} className="text-sm font-bold text-[#123B60] hover:text-[#F59A16] transition-colors">
                        {websiteContent.contact.phone}
                      </a>
                    </div>
                  </motion.div>
                </StaggerItem>

                <StaggerItem>
                  <motion.div className="flex items-center gap-3 text-slate-700" whileHover={{ x: 4 }} transition={transitions.micro}>
                    <div className="w-10 h-10 rounded-xl bg-[#123B60]/10 flex items-center justify-center text-[#123B60] shrink-0">
                      <MapPin className="w-5 h-5" />
                    </div>
                    <div>
                      <div className="text-xs text-slate-500 font-semibold">Location</div>
                      <div className="text-sm font-bold text-[#123B60]">
                        {websiteContent.contact.location}
                      </div>
                    </div>
                  </motion.div>
                </StaggerItem>
              </StaggerGroup>

              <Reveal delay={0.2}>
                <div className="pt-4 flex items-center gap-3">
                  <span className="text-xs font-bold text-slate-500 uppercase">Confirmed Social Handle:</span>
                  <span className="px-3 py-1 bg-slate-100 border border-slate-200 text-[#123B60] font-bold text-xs rounded-md hover:border-[#F59A16] transition-colors">
                    {websiteContent.contact.socialHandle}
                  </span>
                </div>
              </Reveal>
            </div>

            {/* Quick Inquiry / Recruitment CTA Box */}
            <Reveal delay={0.1} y={32} className="lg:col-span-6">
              <div className="bg-gradient-to-br from-[#123B60] to-[#0A2239] rounded-3xl p-8 sm:p-10 text-white shadow-2xl relative overflow-hidden">
                <div className="absolute inset-0 bg-grid-pattern-dark opacity-10 pointer-events-none"></div>
                <div className="relative z-10">
                  <span className="text-xs font-bold text-[#F59A16] uppercase tracking-wider">Recruitment 2026-2027</span>
                  <h3 className="text-2xl sm:text-3xl font-black text-white mt-1">Ready to Join the Chapter?</h3>
                  <p className="text-xs text-slate-200 mt-3 leading-relaxed">
                    Step into a community dedicated to real engineering excellence, advanced materials, and career leadership.
                  </p>

                  <div className="mt-8 space-y-4">
                    <MagneticButton
                      onClick={onNavigateToJoin}
                      strength={0.15}
                      className="w-full py-4 bg-[#F59A16] hover:bg-[#D47F0A] text-white font-bold rounded-xl shadow-lg flex items-center justify-center gap-2 text-sm"
                    >
                      Apply For Membership
                      <ArrowRight className="w-4 h-4" />
                    </MagneticButton>
                    <motion.button
                      onClick={onNavigateToDashboard}
                      className="w-full py-3 bg-white/10 hover:bg-white/20 text-white font-semibold rounded-xl border border-white/20 flex items-center justify-center gap-2 text-xs"
                      whileHover={{ y: -2 }}
                      whileTap={{ scale: 0.98 }}
                      transition={transitions.micro}
                    >
                      <ShieldCheck className="w-4 h-4 text-[#F59A16]" />
                      Internal Leadership Login
                    </motion.button>
                  </div>

                  <div className="mt-6 text-center text-[11px] text-slate-400">
                    Simulated local deployment • Faculty of Engineering, Cairo University
                  </div>
                </div>
              </div>
            </Reveal>
          </div>

        </div>
      </section>

      {/* Footer */}
      <footer className="bg-[#0A2239] text-white py-12 border-t border-white/10 text-xs">
        <Reveal y={16}>
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
        </Reveal>
      </footer>

    </div>
  );
};

const fadeUpSoftItem = {
  hidden: { opacity: 0, y: 20 },
  visible: { opacity: 1, y: 0, transition: { duration: 0.5, ease: [0.22, 1, 0.36, 1] as const } },
};
