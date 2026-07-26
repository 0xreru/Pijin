'use client';

import {
  Layout,
  Hero,
  About,
  ProductTour,
  MeetTheTeam,
  FAQ,
  Banner,
  Footer,
} from './components';

export default function HomePage() {
  return (
    <Layout>
      <Hero />
      <About />
      <ProductTour />
      <MeetTheTeam />
      <FAQ />
      <Banner />
      <Footer />
    </Layout>
  );
}
