export interface HistoricalMilestone {
  period: string;
  badge: string;
  summary: string;
  activities: {
    name: string;
    type: string;
    year: string;
    notes: string;
  }[];
  image?: string;
}

export const HISTORICAL_MILESTONES: HistoricalMilestone[] = [
  {
    period: '2015:2016',
    badge: 'Foundation & First Conference',
    summary: 'Established the chapter base, highlighted by the First Conference (EISC), key field trips, and initial specialized training, successfully linking academic theory with practical industry application.',
    image: '/branding/board_poster_2025_2026.png',
    activities: [
      { name: 'Field Trip', type: 'Field Trip', year: '2015', notes: 'Educational Field Trip for metallurgical students.' },
      { name: 'Welcome party of The First Conference EISC', type: 'Conference/Event', year: '2015', notes: 'Welcome ceremony for the First EISC Conference.' },
      { name: 'Event Sponsors EISC (ESME & Iron & Steel)', type: 'Conference/Event', year: '2016', notes: 'Sponsorship Event (Sponsored by Iron & Steel).' },
      { name: 'Workshop of Software & Materials property data', type: 'Workshop', year: '2016', notes: 'Workshop on software and material properties data.' },
      { name: 'Media Coverage', type: 'Media Coverage', year: '2016', notes: 'Media coverage of the chapter activities.' },
      { name: 'Field Trips Grascom Welding & Inspection', type: 'Field Trip', year: '2016', notes: 'Educational trips on welding and inspection.' },
      { name: 'Training (Health Profession/Safety)', type: 'Training', year: '2016', notes: 'Training (Occupational Safety and Health).' }
    ]
  },
  {
    period: '2017:2018',
    badge: 'Expansion & EISC 2',
    summary: 'Focus shifted to expansion and collaboration, featuring joint events with ESME Suez and ASME, hosting the Second EISC Conference (EISC 2), and department-focused activities.',
    image: '/history/doc_p6_img0_532.jpeg',
    activities: [
      { name: 'Event ESME & ASME', type: 'Conference/Event', year: '2017', notes: 'Collaborative event with ESME and ASME societies.' },
      { name: 'Materials and Mechanics Engineering Department', type: 'Conference/Event', year: '2017', notes: 'Department-specific academic event.' },
      { name: 'EISC Conference Event', type: 'Conference/Event', year: '2017', notes: 'Conference event related to EISC.' },
      { name: 'EISC 2 (The Second EISC Event)', type: 'Conference/Event', year: '2018', notes: 'The Second EISC Conference boosting chapter standing.' }
    ]
  },
  {
    period: '2019:2020',
    badge: 'Industrial Ties & Career Bridge',
    summary: 'Activities centered on career preparation, including a major educational field trip to Ezz Steel and the organization of the Annual Job Fair, connecting students with leading employers.',
    image: '/history/doc_p6_img2_542.jpeg',
    activities: [
      { name: 'Field Trip Ezz Steel', type: 'Field Trip', year: '2019', notes: 'Major educational visit to Ezz Steel manufacturing plant.' },
      { name: 'EISC Conference Event', type: 'Conference/Event', year: '2019', notes: 'Annual chapter gathering and technical sessions.' },
      { name: 'Job Fair On Fair', type: 'Exhibition', year: '2020', notes: 'Organization of career fair bridging students to industry.' }
    ]
  },
  {
    period: '2021:2022',
    badge: 'Occupational Safety & CDC Partnerships',
    summary: 'Prioritized specialized skill development through Safety Engineer Workshops and petroleum industry training, often in partnership with Cairo University Career Development Center (CDC).',
    image: '/history/doc_p6_img4_551.jpeg',
    activities: [
      { name: 'CDC Event', type: 'Event', year: '2022', notes: 'Event in collaboration with the Career Development Center (CDC).' },
      { name: 'Workshop Safety Engineer Job', type: 'Workshop', year: '2022', notes: 'Specialized workshop on the Safety Engineer profession.' }
    ]
  },
  {
    period: '2023',
    badge: 'Drilling & Petroleum Services Training',
    summary: 'Advanced safety certification and petroleum drilling services training conducted in direct collaboration with industrial engineering partners.',
    image: '/history/doc_p6_img5_555.jpeg',
    activities: [
      { name: 'Safety for petroleum drilling and Services AGBSK Engineering', type: 'Training/Course', year: '2023', notes: 'Professional safety training in collaboration with AGBSK Engineering.' }
    ]
  }
];

export interface AppreciationProfile {
  id: string;
  name: string;
  title: string;
  role: string;
  department: string;
  image: string;
  bio: string;
  isVerified: boolean;
  notes: string;
}

export const APPRECIATION_PROFILES: AppreciationProfile[] = [
  {
    id: 'apprec_001',
    name: 'Dr. Mohamed Ibrahim',
    title: 'Doctor / Academic Faculty',
    role: 'Former Chapter Leader & Faculty Academic',
    department: 'Department of Metallurgical Engineering, Cairo University',
    image: '/appreciation/dr_mohamed_ibrahim.jpg',
    bio: 'Former ESME Cairo chapter member who progressed to represent academic and professional excellence as a Doctor at the Faculty of Engineering, Cairo University. Embodying our standard of academic distinction.',
    isVerified: true,
    notes: 'Named in official chapter appreciation document (Page 3).'
  },
  {
    id: 'apprec_002',
    name: 'Eng. Mostafa El Deeb',
    title: 'Teaching Assistant (Academic)',
    role: 'Former Chapter Leader & Faculty Academic',
    department: 'Department of Metallurgical Engineering, Cairo University',
    image: '/appreciation/eng_mostafa_el_deeb.jpg',
    bio: 'Distinguished alumnus whose character and engineering capabilities were cultivated in the chapter, now serving as a Teaching Assistant at the Faculty of Engineering, Cairo University.',
    isVerified: true,
    notes: 'Named in official chapter appreciation document (Page 3).'
  },
  {
    id: 'apprec_003',
    name: 'Eng. Karam-Allah Elsawy',
    title: 'Teaching Assistant (Academic)',
    role: 'Former Chapter Leader & Faculty Academic',
    department: 'Department of Metallurgical Engineering, Cairo University',
    image: '/appreciation/eng_karam_allah_elsawy.jpg',
    bio: 'Exemplary graduate from the Department of Metallurgical Engineering, currently inspiring students as a Teaching Assistant at Cairo University while championing industry-academic bridges.',
    isVerified: true,
    notes: 'Named in official chapter appreciation document (Page 3).'
  }
];

export const HISTORICAL_SOCIAL_INSIGHTS = {
  reportDate: 'October 2026',
  summary: 'Concise performance report based on Meta Insights screenshots analyzed for 4 official posts.',
  totalViews: 43217,
  avgViewsPerPost: 10804,
  totalInteractions: 2232,
  bestSinglePost: {
    title: 'Achievement Spotlight',
    views: 17105,
    interactions: 1056,
    shares: 17,
    engagementRate: '6.2%'
  },
  highestEngagementPost: {
    title: 'Recruitment Open',
    views: 5133,
    interactions: 423,
    engagementRate: '8.2%'
  },
  posts: [
    { title: 'Achievement Spotlight', views: 17105, interactions: 1056, shares: 17, rate: '6.2%', role: 'People-led view driver' },
    { title: 'Board Reveal Cards', views: 16644, interactions: 517, shares: 35, rate: '3.1%', role: 'Chapter leadership showcase' },
    { title: 'Recruitment Open', views: 5133, interactions: 423, shares: 12, rate: '8.2%', role: 'Call-to-action conversion' },
    { title: 'T&E Committee Reveal', views: 4335, interactions: 236, shares: 8, rate: '5.4%', role: 'Technical pillar positioning' }
  ],
  audienceDemographics: [
    { ageRange: '18-24', percentage: 64.8, primary: true },
    { ageRange: '25-34', percentage: 20.5, primary: false },
    { ageRange: '35-44', percentage: 9.3, primary: false },
    { ageRange: '45-54', percentage: 3.7, primary: false },
    { ageRange: '55-64', percentage: 1.7, primary: false }
  ],
  strategicRecommendations: [
    {
      rule: '1. Lead with people',
      detail: 'Keep using real faces, names, titles, achievements, and team moments. This is the strongest view driver.'
    },
    {
      rule: '2. Make the CTA early',
      detail: 'For recruitment and committee posts, place the main action in the first line: apply, comment, share, or message.'
    },
    {
      rule: '3. Turn posts into series',
      detail: 'Create repeatable formats: Board Spotlight, Behind the Team, Committee Deep Dive, and Student Opportunity.'
    }
  ]
};
