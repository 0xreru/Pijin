'use client';

import {
  Layout,
  Hero,
  About,
  MeetTheTeam,
  FAQ,
  Footer,
} from './components';

export default function HomePage() {
  return (
    <Layout>
      <Hero />
      <About />
      <MeetTheTeam />
      <FAQ />
      <Footer />
    </Layout>
  );
}
