const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
if (reducedMotion) {
  // Keep the existing CSS artwork as the lightweight, motion-free fallback.
} else {
  const THREE_URL = 'https://cdn.jsdelivr.net/npm/three@0.187.0/build/three.module.js';
  const ANIME_URL = 'https://cdn.jsdelivr.net/npm/animejs@4.5.0/+esm';

  const animeImport = import(ANIME_URL);
  const threeImport = window.matchMedia('(min-width: 761px)').matches
    ? import(THREE_URL)
    : Promise.resolve(null);

  Promise.all([animeImport, threeImport])
    .then(([anime, THREE]) => {
      const { animate, createTimeline, stagger } = anime;
      const hero = document.querySelector('.hero-art');

      // A short, one-time intro. Content stays visible if either library fails to load.
      const intro = createTimeline({ defaults: { duration: 620, ease: 'outCubic' } });
      intro.add('.hero-copy .eyebrow', { opacity: [0, 1], y: [8, 0] })
        .add('#hero-title', { opacity: [0, 1], y: [12, 0] }, '-=430')
        .add('.hero-deck, .hero-link', {
          opacity: [0, 1], y: [8, 0], delay: stagger(75),
        }, '-=400');

      const seenStories = new Set();
      const revealStories = () => {
        const fresh = [...document.querySelectorAll('.featured-card[data-id], .story-card[data-id]')]
          .filter((card) => {
            const id = card.dataset.id;
            if (!id || seenStories.has(id)) return false;
            seenStories.add(id);
            return true;
          });
        if (fresh.length) animate(fresh, {
          opacity: [0, 1], y: [10, 0],
          delay: stagger(45), duration: 420, ease: 'outCubic',
        });
      };
      const feedObserver = new MutationObserver(revealStories);
      document.querySelectorAll('#featured-column, #story-column').forEach((column) => {
        feedObserver.observe(column, { childList: true });
      });
      revealStories();
      if (!THREE || !hero) return;

      const canvas = document.createElement('canvas');
      canvas.className = 'hero-canvas';
      canvas.setAttribute('aria-hidden', 'true');

      let renderer;
      try {
        renderer = new THREE.WebGLRenderer({
          canvas,
          alpha: true,
          antialias: false,
          powerPreference: 'low-power',
        });
      } catch {
        return;
      }

      renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.25));
      renderer.setSize(hero.clientWidth, hero.clientHeight, false);
      renderer.setClearColor(0x000000, 0);

      const scene = new THREE.Scene();
      const camera = new THREE.PerspectiveCamera(34, 1, 0.1, 20);
      camera.position.z = 5.4;

      const signal = new THREE.Group();
      scene.add(signal);
      scene.add(new THREE.Mesh(
        new THREE.SphereGeometry(1.18, 24, 18),
        new THREE.MeshBasicMaterial({ color: 0x171d1a }),
      ));

      const ringMaterial = new THREE.MeshBasicMaterial({
        color: 0x65705f,
        transparent: true,
        opacity: 0.62,
        wireframe: true,
      });
      [0, 1, 2].forEach((index) => {
        const ring = new THREE.Mesh(new THREE.TorusGeometry(1.28 + index * 0.08, 0.008, 3, 48), ringMaterial);
        ring.rotation.set(0.7 + index * 0.35, 0.3 + index * 0.55, index * 0.8);
        signal.add(ring);
      });



      const resize = () => {
        const width = Math.max(1, hero.clientWidth);
        const height = Math.max(1, hero.clientHeight);
        renderer.setSize(width, height, false);
        camera.aspect = width / height;
        camera.updateProjectionMatrix();
      };
      const resizeObserver = new ResizeObserver(resize);
      resizeObserver.observe(hero);
      hero.prepend(canvas);
      hero.classList.add('hero-art--3d');

      let active = false;
      let lastFrame = 0;
      const render = (time = 0) => {
        if (!active || time - lastFrame < 42) return;
        lastFrame = time;
        signal.rotation.y = time * 0.00012;
        signal.rotation.x = Math.sin(time * 0.00016) * 0.035;
        renderer.render(scene, camera);
      };
      const visibility = new IntersectionObserver(([entry]) => {
        active = entry.isIntersecting && !document.hidden && window.innerWidth > 760;
        renderer.setAnimationLoop(active ? render : null);
        if (active) render();
      }, { threshold: 0.05 });
      visibility.observe(hero);
      window.matchMedia('(min-width: 761px)').addEventListener('change', () => {
        active = window.innerWidth > 760 && !document.hidden && hero.getBoundingClientRect().bottom > 0 && hero.getBoundingClientRect().top < innerHeight;
        renderer.setAnimationLoop(active ? render : null);
      });
      document.addEventListener('visibilitychange', () => {
        active = !document.hidden && window.innerWidth > 760 && hero.getBoundingClientRect().bottom > 0 && hero.getBoundingClientRect().top < innerHeight;
        renderer.setAnimationLoop(active ? render : null);
      });

    })
    .catch((error) => console.info('Optional motion effects unavailable; using static artwork.', error));
}
