import { ScrollReveal } from '../ScrollReveal'

interface TeamMember {
  name: string
  role: string
  image: string
  badge?: string
  socials: {
    facebook?: string
    linkedin?: string
    github?: string
  }
}

const teamLead: TeamMember = {
  name: 'Carl Arbolado',
  role: 'Team Lead / Frontend Developer / UI/UX Designer',
  image: '/assets/team/carl.jpg',
  socials: {
    facebook: 'https://www.facebook.com/carl.arbolado.92',
    linkedin: 'https://www.linkedin.com/in/carl-arbolado-a9a5213b1/',
    github: 'https://github.com/Kaido147'
  }
}

const teamMembers: TeamMember[] = [
  {
    name: 'Erickson Guhilde',
    role: 'UI/UX Designer / Frontend Developer',
    image: '/assets/team/erickson.jpg',
    badge: 'Frontend',
    socials: {
      facebook: 'https://www.facebook.com/erickson.guhilde.50',
      linkedin: 'https://www.linkedin.com/in/erickson-guhilde/',
      github: 'https://github.com/riXoon'
    }
  },
  {
    name: 'Cedric Paul Mendoza',
    role: 'Pitcher / System Architect / System Analyst',
    image: '/assets/team/ced.jpg',
    badge: 'Pitcher',
    socials: {
      facebook: 'https://www.facebook.com/ctieuadea',
      linkedin: 'https://www.linkedin.com/in/cedric-paul-mendoza-382453390/',
      github: 'https://github.com/daeroSys'
    }
  },
  {
    name: 'Janrell Quiaroro',
    role: 'Backend Developer / Smart Contract Developer / DevOps',
    image: '/assets/team/janrell.jpg',
    badge: 'Backend ',
    socials: {
      facebook: 'https://www.facebook.com/xreru',
      linkedin: 'https://www.linkedin.com/in/reru/',
      github: 'https://github.com/0xreru'
    }
  },
  {
    name: 'Mark Kengie Aldabon',
    role: 'Database Designer / DevOps',
    image: '/assets/team/mark.jpg',
    badge: 'DevOps',
    socials: {
      facebook: 'https://facebook.com',
      linkedin: 'https://www.linkedin.com/in/mark-a-a765763b5/',
      github: 'https://github.com/tambayNgOrtigasAvenue'
    }
  }
]

export function MeetTheTeam() {
  return (
    <section id="team" className="py-20 lg:py-32 bg-[#F8FAFC] relative overflow-hidden">
      {/* Decorative Top subtle separator */}
      <div className="absolute top-0 left-0 w-full h-[1px] bg-gradient-to-r from-transparent via-slate-200 to-transparent"></div>

      <div className="max-w-7xl mx-auto px-6 sm:px-8 lg:px-12 relative z-10">

        {/* Section Title */}
        <div className="flex flex-col items-center text-center mb-16 lg:mb-20">
          <ScrollReveal direction="up" delay={100} duration={800}>
            <span className="text-[#1e3e62] text-xs sm:text-sm font-bold tracking-widest uppercase mb-3 block font-sans">
              OUR TEAM
            </span>
          </ScrollReveal>

          <ScrollReveal direction="up" delay={200} duration={800}>
            <h2 className="text-[36px] sm:text-5xl lg:text-[52px] font-bold tracking-tight text-black leading-tight font-display max-w-2xl">
              Meet the Builders of Pijin
            </h2>
          </ScrollReveal>

          <ScrollReveal direction="up" delay={300} duration={800}>
            <p className="text-slate-500 font-medium text-sm sm:text-base lg:text-lg mt-4 leading-relaxed max-w-[600px] font-sans">
              We are dedicated to bridging the digital divide by building secure, reliable offline transaction solutions for everyone.
            </p>
          </ScrollReveal>
        </div>

        {/* 1. Team Lead Section (Centered at the top) */}
        <div className="flex justify-center mb-16 lg:mb-20">
          <ScrollReveal
            direction="up"
            delay={100}
            duration={800}
            className="w-full max-w-[340px]"
          >
            <div className="group bg-white border-2 border-[#1e3e62]/20 hover:border-[#1e3e62]/50 p-6 rounded-2xl shadow-md hover:shadow-lg hover:-translate-y-2 transition-all duration-300 flex flex-col relative">

              {/* Team Leader Badge */}
              <div className="absolute top-4 right-4 z-20 bg-[#1e3e62] text-white text-[10px] font-bold px-2.5 py-1 rounded-full uppercase tracking-wider shadow-sm">
                Team Leader
              </div>

              {/* Photo container */}
              <div className="relative w-full aspect-[4/5] rounded-xl overflow-hidden mb-5 bg-slate-100">
                <img
                  src={teamLead.image}
                  alt={teamLead.name}
                  className="w-full h-full object-cover object-center group-hover:scale-105 transition-transform duration-500"
                  loading="lazy"
                />
                <div className="absolute inset-0 bg-gradient-to-t from-slate-900/10 via-transparent to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-300"></div>
              </div>

              {/* Member Info */}
              <div className="flex-grow">
                <h3 className="text-xl sm:text-2xl font-bold text-black font-display mb-1 leading-snug group-hover:text-[#1e3e62] transition-colors duration-200">
                  {teamLead.name}
                </h3>
                <p className="text-[12px] font-extrabold text-[#1e3e62] font-sans uppercase tracking-wider mb-4">
                  {teamLead.role}
                </p>
              </div>

              {/* Social links */}
              <div className="flex items-center space-x-4 pt-4 border-t border-slate-50">
                {teamLead.socials.facebook && (
                  <a
                    href={teamLead.socials.facebook}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-slate-400 hover:text-[#1877F2] transition-colors duration-200 focus:outline-none"
                    aria-label={`${teamLead.name}'s Facebook profile`}
                  >
                    <svg className="w-[18px] h-[18px] fill-current" viewBox="0 0 24 24">
                      <path d="M22 12c0-5.52-4.48-10-10-10S2 6.48 2 12c0 4.84 3.44 8.87 8 9.8V15H8v-3h2V9.5C10 7.57 11.57 6 13.5 6H16v3h-2c-.55 0-1 .45-1 1v2h3v3h-3v6.95c4.56-.93 8-4.96 8-9.75z" />
                    </svg>
                  </a>
                )}
                {teamLead.socials.linkedin && (
                  <a
                    href={teamLead.socials.linkedin}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-slate-400 hover:text-[#0A66C2] transition-colors duration-200 focus:outline-none"
                    aria-label={`${teamLead.name}'s LinkedIn profile`}
                  >
                    <svg className="w-[18px] h-[18px] fill-current" viewBox="0 0 24 24">
                      <path d="M19 3a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h14m-.5 15.5v-5.3a3.26 3.26 0 0 0-3.26-3.26c-.85 0-1.84.52-2.32 1.3v-1.11h-2.79v8.37h2.79v-4.93c0-.77.62-1.4 1.39-1.4a1.4 1.4 0 0 1 1.4 1.4v4.93h2.79M6.88 8.56a1.68 1.68 0 0 0 1.68-1.68c0-.93-.75-1.69-1.68-1.69a1.69 1.69 0 0 0-1.69 1.69c0 .93.76 1.68 1.69 1.68m1.39 9.94v-8.37H5.5v8.37h2.77z" />
                    </svg>
                  </a>
                )}
                {teamLead.socials.github && (
                  <a
                    href={teamLead.socials.github}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-slate-400 hover:text-black transition-colors duration-200 focus:outline-none"
                    aria-label={`${teamLead.name}'s GitHub profile`}
                  >
                    <svg className="w-[18px] h-[18px] fill-current" viewBox="0 0 24 24">
                      <path d="M12 2a10 10 0 0 0-3.16 19.49c.5.1.68-.21.68-.48v-1.7c-2.78.6-3.37-1.34-3.37-1.34-.46-1.16-1.11-1.47-1.11-1.47-.9-.62.07-.6.07-.6 1 .07 1.53 1.03 1.53 1.03.9 1.52 2.34 1.07 2.91.83.1-.65.35-1.09.63-1.34-2.22-.25-4.55-1.11-4.55-4.92 0-1.11.38-2 1.03-2.71-.1-.25-.45-1.29.1-2.64 0 0 .84-.27 2.75 1.02.79-.22 1.65-.33 2.5-.33.85 0 1.71.11 2.5.33 1.91-1.29 2.75-1.02 2.75-1.02.55 1.35.2 2.39.1 2.64.65.71 1.03 1.6 1.03 2.71 0 3.82-2.34 4.66-4.57 4.91.36.31.69.92.69 1.85V21c0 .27.16.59.67.5A10 10 0 0 0 12 2z" />
                    </svg>
                  </a>
                )}
              </div>

            </div>
          </ScrollReveal>
        </div>

        {/* 2. Core Team Grid (4 columns below) */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-8 lg:gap-10 justify-items-center">
          {teamMembers.map((member, idx) => (
            <ScrollReveal
              key={member.name}
              direction="up"
              delay={(idx + 1) * 100}
              duration={800}
              className="w-full max-w-[280px] flex"
            >
              <div className="group bg-white border border-slate-100 hover:border-slate-200/80 p-5 rounded-2xl shadow-sm hover:shadow-md hover:-translate-y-1.5 transition-all duration-300 flex flex-col w-full h-full relative">

                {/* Member Badge */}
                {member.badge && (
                  <div className="absolute top-4 right-4 z-20 bg-[#1e3e62] text-white text-[10px] font-bold px-2.5 py-1 rounded-full uppercase tracking-wider shadow-sm">
                    {member.badge}
                  </div>
                )}

                {/* Photo container */}
                <div className="relative w-full aspect-[4/5] rounded-xl overflow-hidden mb-5 bg-slate-100">
                  <img
                    src={member.image}
                    alt={member.name}
                    className="w-full h-full object-cover object-center group-hover:scale-105 transition-transform duration-500"
                    loading="lazy"
                  />
                  <div className="absolute inset-0 bg-gradient-to-t from-slate-900/10 via-transparent to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-300"></div>
                </div>

                {/* Member Info */}
                <div className="flex-grow">
                  <h3 className="text-lg font-bold text-black font-display mb-1 leading-snug group-hover:text-[#1e3e62] transition-colors duration-200">
                    {member.name}
                  </h3>
                  <p className="text-xs font-bold text-[#1e3e62] font-sans uppercase tracking-wider mb-4 leading-normal">
                    {member.role}
                  </p>
                </div>

                {/* Social links */}
                <div className="flex items-center space-x-4 pt-4 border-t border-slate-50">
                  {member.socials.facebook && (
                    <a
                      href={member.socials.facebook}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-slate-400 hover:text-[#1877F2] transition-colors duration-200 focus:outline-none"
                      aria-label={`${member.name}'s Facebook profile`}
                    >
                      <svg className="w-[18px] h-[18px] fill-current" viewBox="0 0 24 24">
                        <path d="M22 12c0-5.52-4.48-10-10-10S2 6.48 2 12c0 4.84 3.44 8.87 8 9.8V15H8v-3h2V9.5C10 7.57 11.57 6 13.5 6H16v3h-2c-.55 0-1 .45-1 1v2h3v3h-3v6.95c4.56-.93 8-4.96 8-9.75z" />
                      </svg>
                    </a>
                  )}
                  {member.socials.linkedin && (
                    <a
                      href={member.socials.linkedin}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-slate-400 hover:text-[#0A66C2] transition-colors duration-200 focus:outline-none"
                      aria-label={`${member.name}'s LinkedIn profile`}
                    >
                      <svg className="w-[18px] h-[18px] fill-current" viewBox="0 0 24 24">
                        <path d="M19 3a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h14m-.5 15.5v-5.3a3.26 3.26 0 0 0-3.26-3.26c-.85 0-1.84.52-2.32 1.3v-1.11h-2.79v8.37h2.79v-4.93c0-.77.62-1.4 1.39-1.4a1.4 1.4 0 0 1 1.4 1.4v4.93h2.79M6.88 8.56a1.68 1.68 0 0 0 1.68-1.68c0-.93-.75-1.69-1.68-1.69a1.69 1.69 0 0 0-1.69 1.69c0 .93.76 1.68 1.69 1.68m1.39 9.94v-8.37H5.5v8.37h2.77z" />
                      </svg>
                    </a>
                  )}
                  {member.socials.github && (
                    <a
                      href={member.socials.github}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-slate-400 hover:text-black transition-colors duration-200 focus:outline-none"
                      aria-label={`${member.name}'s GitHub profile`}
                    >
                      <svg className="w-[18px] h-[18px] fill-current" viewBox="0 0 24 24">
                        <path d="M12 2a10 10 0 0 0-3.16 19.49c.5.1.68-.21.68-.48v-1.7c-2.78.6-3.37-1.34-3.37-1.34-.46-1.16-1.11-1.47-1.11-1.47-.9-.62.07-.6.07-.6 1 .07 1.53 1.03 1.53 1.03.9 1.52 2.34 1.07 2.91.83.1-.65.35-1.09.63-1.34-2.22-.25-4.55-1.11-4.55-4.92 0-1.11.38-2 1.03-2.71-.1-.25-.45-1.29.1-2.64 0 0 .84-.27 2.75 1.02.79-.22 1.65-.33 2.5-.33.85 0 1.71.11 2.5.33 1.91-1.29 2.75-1.02 2.75-1.02.55 1.35.2 2.39.1 2.64.65.71 1.03 1.6 1.03 2.71 0 3.82-2.34 4.66-4.57 4.91.36.31.69.92.69 1.85V21c0 .27.16.59.67.5A10 10 0 0 0 12 2z" />
                      </svg>
                    </a>
                  )}
                </div>

              </div>
            </ScrollReveal>
          ))}
        </div>

      </div>
    </section>
  )
}
