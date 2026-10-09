// Interaction of a UI Lab guide page: reveal-on-scroll, reading progress,
// step navigation, marker/legend linking and the full-capture lightbox. The
// page works without it (print, no script) and never stores anything.
(() => {
  const root = document.documentElement
  root.classList.add('js')
  const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches
  const reveals = [...document.querySelectorAll('.reveal')]
  const showAll = () => reveals.forEach((el) => el.classList.add('in'))
  // Reveal is decoration and must never hide content: what is already on
  // screen shows at once, and everything shows if the observer stays silent.
  const inView = (el) => el.getBoundingClientRect().top < innerHeight
  reveals.filter(inView).forEach((el) => el.classList.add('in'))
  if ('IntersectionObserver' in window && !reduce) {
    let answered = false
    const io = new IntersectionObserver((entries) => entries.forEach((entry) => {
      answered = true
      if (entry.isIntersecting) { entry.target.classList.add('in'); io.unobserve(entry.target) }
    }), { rootMargin: '0px 0px -8% 0px' })
    reveals.forEach((el) => io.observe(el))
    setTimeout(() => { if (!answered) showAll() }, 1200)
  } else showAll()
  addEventListener('beforeprint', showAll)

  const bar = document.querySelector('.progress span')
  const progress = () => {
    const max = root.scrollHeight - innerHeight
    if (bar) bar.style.transform = `scaleX(${max > 0 ? Math.min(1, scrollY / max) : 0})`
  }
  addEventListener('scroll', progress, { passive: true })
  progress()

  const steps = [...document.querySelectorAll('[data-step]')]
  const links = new Map([...document.querySelectorAll('.toc a')].map((a) => [a.getAttribute('href').slice(1), a]))
  const counter = document.querySelector('.counter')
  let current = 0
  const activate = (index) => {
    if (index < 0 || index >= steps.length) return
    current = index
    links.forEach((a) => a.classList.toggle('active', a === links.get(steps[index].id)))
    if (counter) counter.textContent = `${index + 1} / ${steps.length}`
  }
  if ('IntersectionObserver' in window) {
    const spy = new IntersectionObserver((entries) => entries.forEach((entry) => {
      if (entry.isIntersecting) activate(steps.indexOf(entry.target))
    }), { rootMargin: '-40% 0px -55% 0px' })
    steps.forEach((step) => spy.observe(step))
  }
  const go = (delta) => {
    const next = Math.min(steps.length - 1, Math.max(0, current + delta))
    steps[next]?.scrollIntoView({ behavior: reduce ? 'auto' : 'smooth', block: 'start' })
    activate(next)
  }

  document.querySelectorAll('.shot').forEach((shot) => {
    const light = (n) => shot.querySelectorAll('[data-n]').forEach((el) => el.classList.toggle('lit', n !== undefined && el.dataset.n === n))
    shot.addEventListener('pointerover', (event) => light(event.target.closest('[data-n]')?.dataset.n))
    shot.addEventListener('pointerleave', () => light(undefined))
  })

  const box = document.querySelector('.lightbox')
  const stage = box.querySelector('.lightbox-stage')
  const open = (button) => {
    const frame = document.createElement('div')
    frame.className = 'lightbox-frame'
    const img = new Image()
    img.src = button.dataset.src
    img.alt = button.dataset.alt || ''
    frame.append(img)
    for (const item of (button.dataset.marks || '').split(';').filter(Boolean)) {
      const [n, x, y, w, h] = item.split(',').map(Number)
      const mark = document.createElement('span')
      mark.className = 'mark'
      Object.assign(mark.style, { left: `${x * 100}%`, top: `${y * 100}%`, width: `${w * 100}%`, height: `${h * 100}%` })
      const badge = document.createElement('b')
      badge.textContent = String(n)
      mark.append(badge)
      frame.append(mark)
    }
    stage.replaceChildren(frame)
    box.hidden = false
    box.querySelector('.lightbox-close').focus()
  }
  const close = () => { box.hidden = true; stage.replaceChildren() }
  const toggleTheme = () => {
    const dark = root.dataset.theme ? root.dataset.theme === 'dark' : matchMedia('(prefers-color-scheme: dark)').matches
    root.dataset.theme = dark ? 'light' : 'dark'
  }

  document.addEventListener('click', (event) => {
    const zoom = event.target.closest('.zoom') || event.target.closest('.frame')?.querySelector('.zoom')
    const action = event.target.closest('[data-action]')?.dataset.action
    if (zoom && box.hidden) open(zoom)
    else if (action === 'close' || event.target === box) close()
    else if (action === 'prev') go(-1)
    else if (action === 'next') go(1)
    else if (action === 'theme') toggleTheme()
  })
  document.addEventListener('keydown', (event) => {
    if (!box.hidden) { if (event.key === 'Escape') close(); return }
    if (event.key === 'ArrowRight' || event.key === 'j') go(1)
    else if (event.key === 'ArrowLeft' || event.key === 'k') go(-1)
  })
})()
