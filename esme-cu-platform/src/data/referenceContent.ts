import type {
  Committee,
  RegistrationFieldConfig,
  SeasonEvent,
  WebsiteContentConfig
} from '../types';

/**
 * OFFICIAL CHAPTER REFERENCE CONTENT — not demo data.
 *
 * What is here: the committee structure, the registration form schema, the approved
 * 2026-2027 season plan and the public website copy, all taken from the chapter's own
 * documents.
 *
 * What is deliberately absent: people. Fictional members, tasks, submissions, score
 * ledger entries, applications, skill assessments, notifications and audit events were
 * removed from this source. Operational collections start empty and the ERP renders an
 * empty state until real records exist.
 *
 * Committee office-holders and member counts are not listed either: they belong to
 * assignments and rosters, which come from the database.
 *
 * These values seed the CMS on a fresh install. Once an authorized editor publishes,
 * the stored content is authoritative and this file is no longer read.
 */

export const REFERENCE_COMMITTEES: Committee[] = [
  {
    id: 'comm_te',
    name: 'Technical & Engineering Committee',
    shortCode: 'T&E',
    description: 'Core engineering backbone responsible for external technical workshops, major summits (ESME Metrix, EMSC, ETC, EISC), internal capability building, and quarterly scientific reviews.',
    objectives: [
      'Deliver 4 major seasonal events: ESME Metrix, EMSC, ETC, and EISC',
      'Execute 10 hands-on workshops across NDT, Materials Testing, Automation/AI, and Sustainability',
      'Conduct 32 professional sessions (cadence: 4 sessions/month)',
      'Ensure 70% of committee members reach L2+ skill level by July'
    ],
    subTeams: ['NDT & Inspection', 'Materials Testing & AI', 'Automation & Robotics', 'Sustainability & Green Steel'],
    isPublic: true,
    status: 'active',
    category: 'technical'
  },
  {
    id: 'comm_mc',
    name: 'Media & Content Committee',
    shortCode: 'M&C',
    description: 'Orchestrates the chapter editorial engine, publishing weekly technical and soft-skill insights, coordinating video reels, and compiling the quarterly scientific magazine.',
    objectives: [
      'Maintain weekly publishing target of 2 posts (1 technical + 1 general soft skills)',
      'Produce 3 issues of the ESME Scientific Magazine (Dec, Mar, Jun)',
      'Coordinate 24 hours of committee competency training (45m general + 75m specialized)',
      'Publish 24 official posts across confirmed social channels'
    ],
    subTeams: ['Technical Post Writers', 'General Post Writers', 'Scientific Magazine Editorial', 'Video Production & Reels'],
    isPublic: true,
    status: 'active',
    category: 'media'
  },
  {
    id: 'comm_marketing',
    name: 'Marketing Committee',
    shortCode: 'MKT',
    description: 'Leads direct offline activations on Cairo University engineering campus, sticker and brand recall campaigns, and data-driven audience engagement.',
    objectives: [
      'Execute 3 high-impact field marketing campaigns with sticker distributions and student engagement',
      'Drive student recruitment and maintain strong brand recall among 18-24 target audience',
      'Coordinate campus booth presence and event logistical promotion',
      'Track engagement rates with focus on actionable calls-to-action'
    ],
    subTeams: ['Field Marketing & Activations', 'Digital Marketing & Growth', 'Sticker Logistics & Merch', 'Campus Ambassador Network'],
    isPublic: true,
    status: 'active',
    category: 'marketing'
  },
  {
    id: 'comm_design',
    name: 'Design Committee',
    shortCode: 'DES',
    description: 'Crafts the visual identity across all media, delivering 6 approved templates for magazine layouts, technical slides, conference visuals, and brand guidelines.',
    objectives: [
      'Deliver 6 approved design templates (3 Scientific Magazine + 3 Scientific Slides)',
      'Maintain rigorous brand standards with Navy (#123B60) and Orange (#F59A16) palette',
      'Produce high-impact graphics for post announcements and summit materials',
      'Establish visual archiving for all chapter graphics'
    ],
    subTeams: ['Scientific Magazine Templates', 'Scientific Lecture Slides', 'Social Infographics', 'Brand Identity & Print'],
    isPublic: true,
    status: 'active',
    category: 'operations'
  }
];

export const REFERENCE_FORM_FIELDS: RegistrationFieldConfig[] = [
  { id: 'f1', label: 'Full Name', name: 'fullName', type: 'text', required: true, enabled: true, order: 1 },
  { id: 'f2', label: 'University Email', name: 'universityEmail', type: 'email', required: true, enabled: true, order: 2 },
  { id: 'f3', label: 'Student ID', name: 'studentId', type: 'text', required: true, enabled: true, order: 3 },
  { id: 'f4', label: 'Academic Year', name: 'academicYear', type: 'select', required: true, enabled: true, options: ['Freshman', 'Sophomore', 'Junior', 'Senior I', 'Senior II', 'Postgraduate'], order: 4 },
  { id: 'f5', label: 'Department / Major', name: 'department', type: 'select', required: true, enabled: true, options: ['Metallurgical & Materials Engineering', 'Mechanical Design & Production', 'Mechanical Power Engineering', 'Chemical Engineering', 'Civil Engineering', 'Aerospace Engineering', 'Other'], order: 5 },
  { id: 'f6', label: 'Phone Number (WhatsApp)', name: 'phone', type: 'tel', required: true, enabled: true, order: 6 },
  { id: 'f7', label: 'Primary Committee Preference', name: 'preferredCommitteeId', type: 'select', required: true, enabled: true, order: 7 },
  { id: 'f8', label: 'Secondary Committee Preference (Optional)', name: 'secondCommitteePreferenceId', type: 'select', required: false, enabled: true, order: 8 },
  { id: 'f9', label: 'Technical & Professional Skills', name: 'technicalSkills', type: 'textarea', required: true, enabled: true, description: 'List engineering software, laboratory skills, writing, design, or project management capabilities.', order: 9 },
  { id: 'f10', label: 'Previous Experience & Projects', name: 'previousExperience', type: 'textarea', required: false, enabled: true, order: 10 },
  { id: 'f11', label: 'Motivation for Joining ESME CU', name: 'motivation', type: 'textarea', required: true, enabled: true, description: 'What do you aim to learn and contribute to our 2026-2027 vision?', order: 11 },
  { id: 'f12', label: 'Weekly Availability', name: 'availabilityHours', type: 'select', required: true, enabled: true, options: ['5-8 hours/week', '9-12 hours/week', '13-16 hours/week', '16+ hours/week'], order: 12 },
  { id: 'f13', label: 'Agreement to Chapter Policies & Code of Conduct', name: 'agreedToPolicies', type: 'checkbox', required: true, enabled: true, order: 13 }
];

export const REFERENCE_SEASON_EVENTS: SeasonEvent[] = [
  // 4 Major Events
  {
    id: 'evt_001',
    title: 'ESME Metrix Summit',
    acronym: 'ESME Metrix',
    category: 'Major Event',
    theme: 'Materials Engineering & Advanced Characterization Summit',
    dateOrQuarter: '15-20 November 2026',
    status: 'In Preparation',
    targetMetric: '150+ Attendees',
    responsibleCommittee: 'Technical & Engineering Committee',
    description: 'Q1 Flagship conference hosting leading metallurgy scholars, industrial QA/QC directors, and students for 5 intensive days of talks and exhibitions.',
    venue: 'Faculty of Engineering Auditorium, Cairo University',
    isPublic: true
  },
  {
    id: 'evt_002',
    title: 'Egyptian Materials Science Conference',
    acronym: 'EMSC',
    category: 'Major Event',
    theme: 'Industrial Metallurgy & Quality Inspection',
    dateOrQuarter: 'February 2027',
    status: 'Planned',
    targetMetric: '200+ Attendees',
    responsibleCommittee: 'Technical & Engineering Committee',
    description: 'Q2 Flagship gathering connecting materials research with manufacturing leaders across Egypt.',
    venue: 'Cairo University Convention Center',
    isPublic: true
  },
  {
    id: 'evt_003',
    title: 'Engineering Technology Colloquium',
    acronym: 'ETC',
    category: 'Major Event',
    theme: 'Automation, AI, and Future Engineering Systems',
    dateOrQuarter: 'May 2027',
    status: 'Planned',
    targetMetric: '175+ Attendees',
    responsibleCommittee: 'Technical & Engineering Committee',
    description: 'Q3 Major summit examining generative/agentic AI applied to physical engineering systems.',
    venue: 'Main Campus Hall',
    isPublic: true
  },
  {
    id: 'evt_004',
    title: 'Egyptian Industrial & Student Conference',
    acronym: 'EISC',
    category: 'Major Event',
    theme: 'National Chapter Finale & Graduating Projects Showcase',
    dateOrQuarter: 'July 2027',
    status: 'Planned',
    targetMetric: '250+ Attendees',
    responsibleCommittee: 'Technical & Engineering Committee',
    description: 'Q4 Grand annual convention featuring senior design competitions and nationwide chapters.',
    venue: 'Faculty of Engineering Grand Hall',
    isPublic: true
  },
  // Workshops
  {
    id: 'evt_005',
    title: 'Non-Destructive Testing (NDT) / Ultrasonic & Radiographic Inspection',
    category: 'Workshop',
    theme: 'NDT / Inspection (2-3 days)',
    dateOrQuarter: 'February 2027',
    status: 'Planned',
    targetMetric: '80%+ Completion Rate',
    responsibleCommittee: 'Technical & Engineering Committee',
    description: 'Practical training on ultrasonic flaw detection, magnetic particle inspection, and ASME standards.',
    isPublic: true
  },
  {
    id: 'evt_006',
    title: 'Materials Testing & Mechanical Characterization Lab',
    category: 'Workshop',
    theme: 'Materials Testing (2 days)',
    dateOrQuarter: 'March 2027',
    status: 'Planned',
    targetMetric: '80%+ Completion Rate',
    responsibleCommittee: 'Technical & Engineering Committee',
    description: 'Tensile, impact, hardness, and metallographic microscope sample preparation.',
    isPublic: true
  },
  {
    id: 'evt_007',
    title: 'Generative & Agentic AI in Engineering Systems',
    category: 'Workshop',
    theme: 'Automation / AI (3 days)',
    dateOrQuarter: 'April 2027',
    status: 'Planned',
    targetMetric: '80%+ Completion Rate',
    responsibleCommittee: 'Technical & Engineering Committee',
    description: 'Leveraging modern LLM agents, automated CAD synthesis, and predictive maintenance.',
    isPublic: true
  },
  {
    id: 'evt_008',
    title: 'Green Metallurgy & Sustainable Steelmaking',
    category: 'Workshop',
    theme: 'Sustainability (2 days)',
    dateOrQuarter: 'May 2027',
    status: 'Planned',
    targetMetric: '80%+ Completion Rate',
    responsibleCommittee: 'Technical & Engineering Committee',
    description: 'Decarbonization in metallurgical industries and hydrogen-based direct reduction.',
    isPublic: true
  },
  {
    id: 'evt_009',
    title: 'Finite Element Analysis with ANSYS & SolidWorks Simulation',
    category: 'Workshop',
    theme: 'ANSYS / SolidWorks (3 days)',
    dateOrQuarter: 'June 2027',
    status: 'Planned',
    targetMetric: '80%+ Completion Rate',
    responsibleCommittee: 'Technical & Engineering Committee',
    description: 'Stress distribution, fatigue prediction, and thermal gradient simulations.',
    isPublic: true
  },
  // Scientific Magazine Issues
  {
    id: 'evt_010',
    title: 'ESME Magazine Issue 1: Materials & Manufacturing',
    category: 'Magazine Issue',
    theme: 'Materials & Manufacturing',
    dateOrQuarter: 'December 2026',
    status: 'In Preparation',
    targetMetric: '3-5 Partner Contributions',
    responsibleCommittee: 'Media & Content Committee',
    description: 'Debut quarterly edition exploring modern metallurgy and advanced composites.',
    isPublic: true
  },
  {
    id: 'evt_011',
    title: 'ESME Magazine Issue 2: Inspection & Reliability',
    category: 'Magazine Issue',
    theme: 'Inspection & Reliability',
    dateOrQuarter: 'March 2027',
    status: 'Planned',
    targetMetric: '3-5 Partner Contributions',
    responsibleCommittee: 'Media & Content Committee',
    description: 'Second quarterly release highlighting QA/QC standards and asset integrity.',
    isPublic: true
  },
  {
    id: 'evt_012',
    title: 'ESME Magazine Issue 3: Smart Materials & Industry 4.0',
    category: 'Magazine Issue',
    theme: 'Smart Materials & Industry 4.0',
    dateOrQuarter: 'June 2027',
    status: 'Planned',
    targetMetric: '3-5 Partner Contributions',
    responsibleCommittee: 'Media & Content Committee',
    description: 'Third quarterly publication focused on cyber-physical factories and nanomaterials.',
    isPublic: true
  }
];

export const REFERENCE_WEBSITE_CONTENT: WebsiteContentConfig = {
  hero: {
    badge: 'Official Student Chapter • Cairo University',
    headline: 'Welcome to ESME CU Chapter',
    supportingMessage: 'Empowering Engineering Students. Bridging Academia and Industry. Building the Future.',
    ctaPrimary: 'Login to Dashboard',
    ctaSecondary: 'Join ESME'
  },
  about: {
    title: 'About ESME Cairo University Chapter',
    story: 'ESME is an abbreviation of "Egyptian Society of Materials Engineers". It is the premier scientific society oriented to metallurgical and materials engineering students in Egypt and the North Africa region. Founded in 2009 at the Faculty of Petroleum and Mining Engineering, Suez University, ESME expanded to establish ESME Cairo as its first dedicated branch serving both metallurgical and mechanical engineering students at Cairo University.',
    purpose: 'ESME is dedicated to qualifying Materials Engineering Students to suffice the job market with professional fresh graduates who can bridge the gap between real science and technology opportunities in QA/QC engineering, materials engineering, corrosion engineering, welding inspection, steelmaking, metal processing, and industrial safety.',
    objectives: [
      'Bridge the gap between theoretical classroom coursework and real-world industrial practice.',
      'Build comprehensive engineering character through leadership, soft skills, and teamwork.',
      'Equip students with cutting-edge competencies in Generative & Agentic AI, NDT inspection, and materials testing.',
      'Connect students directly with leading manufacturers through field trips, internships, and national conferences.'
    ],
    values: ['Be Positive Valuable', 'Technical Rigor', 'Ethical Leadership', 'Collaborative Excellence', 'Innovation'],
    foundedYear: '2009 (Suez University)',
    foundingFaculty: 'Faculty of Petroleum and Mining Engineering',
    cairoChapterFounded: '2015 (Cairo University)'
  },
  vision2027: {
    headline: 'Official Vision 2026–2027',
    quote: '"Empowering a Comprehensive Engineering Generation: Bridging the Gap Between Academia and the Industry of the Future"',
    description: 'This year, we aim for ESME CU to be the premier platform that transitions engineering students from the realm of theories to the reality of application. We focus on modern technologies reshaping the industry, such as Generative and Agentic AI, advancements in Material Science, and Non-Destructive Testing (NDT) techniques, ensuring that the Cairo University graduate is fully prepared to lead innovation in the job market.',
    pillars: [
      {
        title: 'Technical Excellence & Technological Adaptation',
        description: 'Launching a series of technical workshops covering materials engineering, mechanical testing, and AI applications in solving engineering problems.',
        points: [
          'Hands-on NDT and materials testing workshops',
          'Generative and Agentic AI applied to engineering',
          'Preparing members for national student conferences and summits'
        ]
      },
      {
        title: 'Industry Integration',
        description: 'Organizing field visits and attending major industrial exhibitions in Egypt to connect students with top companies and manufacturers.',
        points: [
          'Site visits to leading steelmakers, foundries, and inspection labs',
          'Hosting industry veterans for real-world case lectures',
          'Co-sponsorship with engineering societies like ASME and ESME Suez'
        ]
      },
      {
        title: 'Innovation & Projects',
        description: 'Establishing internal competitions (Hackathons or Case Studies) that push students to apply what they have learned in designing solutions for real industrial problems.',
        points: [
          'Industrial Case Study Competitions and engineering hackathons',
          'Quarterly ESME Scientific Magazine publication engine',
          'Micro-output monthly delivery: summaries, checklists, and case notes'
        ]
      },
      {
        title: 'Operational Efficiency & Team Building',
        description: 'Investing in internal training and capability development of chapter members before directing efforts outward, fostering a culture of teamwork, punctuality, and shared responsibility.',
        points: [
          'L0 to L4 competency skill-matrix tracking for every member',
          'Cadence of 4 monthly sessions: 1 offline bonding day + 3 online learning sessions',
          'Transparent points ledger and accountability mechanisms'
        ]
      }
    ]
  },
  contact: {
    email: 'esme.cairostudentchapter@gmail.com',
    phone: '+201223441144',
    website: 'https://www.ESMECairo.com',
    socialHandle: '@ESME_Cairo',
    location: 'Faculty of Engineering, Cairo University, Giza, Egypt'
  }
};

