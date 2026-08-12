import Image from 'next/image'
import Link from 'next/link'
import {
  ArrowRight,
  Hash,
  Headphones,
  Mic2,
  MonitorUp,
  Radio,
  Search,
  SmilePlus,
} from 'lucide-react'
import styles from './landing.module.css'

const LANDING_CONTRACT = [
  'THESIS: Miscord turns an ordinary evening into a shared room; refuses the generic SaaS hero.',
  'OWN-WORLD: night photography, deep cobalt fields, off-white type, compact dark product surfaces.',
  'STORY: see the people, understand text plus voice plus screen, then create an account.',
  'FIRST VIEWPORT: full-bleed Russian evening scene, two-line promise left, live room proof right, signup below.',
  'FORM: approved Community Stage with Living Desktop proof; seed prototype-community-living-v1.',
  'FINISH: unreviewed and undocumented is unfinished; this build ends with the finish review, the verdict, and DESIGN.md.',
].join(' ')

const people = [
  { initials: 'М', name: 'Макс', color: '#ffb86b' },
  { initials: 'А', name: 'Аня', color: '#73d2ff' },
  { initials: 'К', name: 'Кира', color: '#f49ac2' },
  { initials: 'И', name: 'Илья', color: '#9fe870' },
]

const messages = [
  {
    initials: 'К',
    name: 'Кира',
    time: '19:42',
    text: 'Я создала комнату. Кто сегодня в кооп?',
    color: '#f7a6c4',
  },
  {
    initials: 'М',
    name: 'Макс',
    time: '19:43',
    text: 'Уже захожу. Закинь экран, посмотрим сборку.',
    color: '#8fd7ff',
  },
  {
    initials: 'Л',
    name: 'Лера',
    time: '19:44',
    text: 'Я тоже тут. Дайте две минуты.',
    color: '#b8ed83',
  },
]

function Brand() {
  return (
    <Link className={styles.brand} href="/" aria-label="Miscord, главная">
      <span className={styles.brandMark} aria-hidden="true">
        <Image src="/image.svg" alt="" width={31} height={24} priority />
      </span>
      <span>Miscord</span>
    </Link>
  )
}

function VoiceRoomProof() {
  return (
    <aside className={styles.voiceRoom} aria-label="Демонстрация голосовой комнаты">
      <span className={styles.demoLabel}>Демо</span>
      <div className={styles.voiceRoomTitle}>
        <span><Radio size={17} aria-hidden="true" /> После работы</span>
        <span className={styles.liveStatus}>в эфире</span>
      </div>
      <div className={styles.peopleRow} aria-label="Четыре участника">
        {people.map((person) => (
          <span
            key={person.name}
            className={styles.personAvatar}
            style={{ backgroundColor: person.color }}
            title={person.name}
          >
            {person.initials}
          </span>
        ))}
        <span className={styles.peopleCount}>4 в комнате</span>
      </div>
      <div className={styles.voiceControls}>
        <span><Mic2 size={17} aria-hidden="true" /> Микрофон включён</span>
        <span className={styles.headphoneControl} aria-hidden="true"><Headphones size={18} /></span>
      </div>
    </aside>
  )
}

function ProductDemo() {
  return (
    <div className={styles.productDemo} aria-label="Демонстрация интерфейса Miscord">
      <div className={styles.demoTopbar}>
        <div className={styles.demoBrand}>
          <span className={styles.miniBrandMark} aria-hidden="true">M</span>
          <strong>Miscord</strong>
        </div>
        <span className={styles.demoLabel}>Демо интерфейса</span>
      </div>

      <div className={styles.demoWorkspace}>
        <div className={styles.serverRail} aria-hidden="true">
          <span className={styles.activeServer}>M</span>
          <span>К</span>
          <span>+</span>
        </div>

        <aside className={styles.channelDemo}>
          <strong>Вечерний клуб</strong>
          <span className={styles.channelGroup}>ТЕКСТОВЫЕ КАНАЛЫ</span>
          <span className={styles.activeChannel}><Hash size={15} /> общий</span>
          <span><Hash size={15} /> игровые-находки</span>
          <span className={styles.channelGroup}>ГОЛОСОВЫЕ КАНАЛЫ</span>
          <span className={styles.voiceChannel}><Headphones size={15} /> После работы</span>
          <span className={styles.channelMember}>● Кира</span>
          <span className={styles.channelMember}>● Макс</span>
        </aside>

        <div className={styles.chatDemo}>
          <div className={styles.chatDemoHeader}>
            <span><Hash size={17} /> общий</span>
            <Search size={17} aria-hidden="true" />
          </div>
          <div className={styles.messageList}>
            {messages.map((message) => (
              <article key={message.name} className={styles.demoMessage}>
                <span className={styles.demoAvatar} style={{ backgroundColor: message.color }}>
                  {message.initials}
                </span>
                <div>
                  <strong>{message.name}</strong>
                  <time>{message.time}</time>
                  <p>{message.text}</p>
                </div>
              </article>
            ))}
          </div>
          <div className={styles.demoComposer}>
            <span>Написать в #общий</span>
            <SmilePlus size={18} aria-hidden="true" />
          </div>
        </div>

        <aside className={styles.activityDemo}>
          <span className={styles.channelGroup}>СЕЙЧАС ВМЕСТЕ</span>
          <div className={styles.streamPreview}>
            <MonitorUp size={27} aria-hidden="true" />
            <span>Макс делится экраном</span>
          </div>
          <div className={styles.activeCall}>
            <Mic2 size={17} aria-hidden="true" />
            <span><strong>Голос подключён</strong><small>После работы</small></span>
          </div>
        </aside>
      </div>
    </div>
  )
}

export function LandingPage({ className }: { className?: string }) {
  return (
    <main
      id="landing-main"
      className={`${styles.landing} ${className ?? ''}`}
      data-design-contract={LANDING_CONTRACT}
    >
      <a className={styles.skipLink} href="#product">Перейти к возможностям</a>

      <section className={styles.hero} aria-labelledby="landing-title">
        <Image
          src="/landing/miscord-friends-hero-ru.webp"
          alt="Друзья проводят вечер вместе за играми и разговорами"
          fill
          sizes="100vw"
          className={styles.heroPhoto}
          priority
        />
        <div className={styles.heroShade} aria-hidden="true" />

        <header className={styles.header}>
          <Brand />
          <nav className={styles.headerNav} aria-label="Основная навигация">
            <a href="#product">Возможности</a>
            <Link href="/developers">Разработчикам</Link>
          </nav>
          <Link className={styles.loginAction} href="/app">Войти</Link>
        </header>

        <div className={styles.heroCopy}>
          <h1 id="landing-title">Собирайтесь.<br />Как будто рядом.</h1>
          <p>
            Текст, голос и экран в одном месте. Создайте пространство, где свои всегда могут зайти без лишних приглашений.
          </p>
          <Link className={styles.primaryAction} href="/register">
            Создать аккаунт <ArrowRight size={19} aria-hidden="true" />
          </Link>
        </div>

        <VoiceRoomProof />
        <a className={styles.scrollCue} href="#product" aria-label="Перейти к демонстрации продукта">
          <span aria-hidden="true" />
        </a>
      </section>

      <section id="product" className={styles.productSection} aria-labelledby="product-title">
        <div className={styles.productIntro}>
          <h2 id="product-title">Один вечер.<br />Все свои.</h2>
          <div className={styles.productSummary}>
            <p>Miscord держит разговор, голос и совместный экран в одном живом пространстве.</p>
            <Link className={styles.productAction} href="/register">
              Начать общаться <ArrowRight size={18} aria-hidden="true" />
            </Link>
          </div>
        </div>

        <ProductDemo />

        <footer className={styles.footer}>
          <Brand />
          <div className={styles.footerLinks}>
            <Link href="/developers">Разработчикам</Link>
            <Link href="/app">Войти</Link>
            <Link href="/register">Регистрация</Link>
          </div>
          <span>© {new Date().getFullYear()} Miscord</span>
        </footer>
      </section>
    </main>
  )
}
