// ── NAVBAR scroll effect ──────────────────────────────────────
const navbar = document.getElementById('navbar');
window.addEventListener('scroll', () => {
  if (window.scrollY > 40) {
    navbar.classList.add('scrolled');
  } else {
    navbar.classList.remove('scrolled');
  }
});

// ── HAMBURGER menu ────────────────────────────────────────────
const hamburger = document.getElementById('hamburger');
const navLinks  = document.getElementById('nav-links');

hamburger.addEventListener('click', () => {
  navLinks.classList.toggle('open');
});

// Close mobile menu on nav-link click
navLinks.querySelectorAll('.nav-link').forEach(link => {
  link.addEventListener('click', () => navLinks.classList.remove('open'));
});

// ── ACTIVE NAV LINK on scroll ─────────────────────────────────
const sections = document.querySelectorAll('section[id], header[id]');
const navItems = document.querySelectorAll('.nav-link');

const observer = new IntersectionObserver(
  (entries) => {
    entries.forEach(entry => {
      if (entry.isIntersecting) {
        const id = entry.target.getAttribute('id');
        navItems.forEach(link => {
          link.classList.toggle(
            'active',
            link.getAttribute('href') === `#${id}`
          );
        });
      }
    });
  },
  { rootMargin: '-40% 0px -55% 0px', threshold: 0 }
);

sections.forEach(s => observer.observe(s));

// ── SCROLL REVEAL animation ───────────────────────────────────
const revealObserver = new IntersectionObserver(
  (entries) => {
    entries.forEach(entry => {
      if (entry.isIntersecting) {
        entry.target.classList.add('visible');
        revealObserver.unobserve(entry.target);
      }
    });
  },
  { threshold: 0.08 }
);

// Apply reveal class to major block elements
const revealSelectors = [
  '.step-card', '.resource-card', '.contract-card',
  '.feature-card', '.test-card', '.analytics-card',
  '.prereq-item', '.setup-step', '.pipeline-row',
  '.service-item', '.card', '.arch-layer'
];

document.querySelectorAll(revealSelectors.join(',')).forEach((el, i) => {
  el.classList.add('reveal');
  el.style.transitionDelay = `${(i % 4) * 0.07}s`;
  revealObserver.observe(el);
});

// ── SMOOTH anchor scroll with offset ─────────────────────────
document.querySelectorAll('a[href^="#"]').forEach(anchor => {
  anchor.addEventListener('click', function (e) {
    const target = document.querySelector(this.getAttribute('href'));
    if (target) {
      e.preventDefault();
      const offset = 80;
      const top = target.getBoundingClientRect().top + window.pageYOffset - offset;
      window.scrollTo({ top, behavior: 'smooth' });
    }
  });
});

// ── CODE BLOCK copy button ────────────────────────────────────
document.querySelectorAll('.code-block').forEach(block => {
  const btn = document.createElement('button');
  btn.textContent = 'Copy';
  btn.className = 'copy-btn';
  btn.setAttribute('aria-label', 'Copy code');

  Object.assign(btn.style, {
    position: 'absolute',
    top: '0.6rem',
    right: '0.6rem',
    background: 'rgba(124,58,237,0.2)',
    border: '1px solid rgba(124,58,237,0.35)',
    color: '#c4b5fd',
    borderRadius: '6px',
    padding: '0.25rem 0.6rem',
    fontSize: '0.72rem',
    fontWeight: '600',
    cursor: 'pointer',
    fontFamily: 'inherit',
    transition: 'background 0.2s',
    zIndex: '10'
  });

  block.style.position = 'relative';
  block.appendChild(btn);

  btn.addEventListener('click', () => {
    const code = block.querySelector('code');
    if (code) {
      navigator.clipboard.writeText(code.innerText).then(() => {
        btn.textContent = '✓ Copied';
        btn.style.background = 'rgba(16,185,129,0.2)';
        btn.style.borderColor = 'rgba(16,185,129,0.4)';
        btn.style.color = '#6ee7b7';
        setTimeout(() => {
          btn.textContent = 'Copy';
          btn.style.background = 'rgba(124,58,237,0.2)';
          btn.style.borderColor = 'rgba(124,58,237,0.35)';
          btn.style.color = '#c4b5fd';
        }, 2000);
      });
    }
  });
});

// ── ACTIVE NAV LINK style injection ──────────────────────────
const style = document.createElement('style');
style.textContent = `
  .nav-link.active {
    color: var(--clr-purple-lt) !important;
    background: rgba(124,58,237,0.12) !important;
  }
`;
document.head.appendChild(style);
