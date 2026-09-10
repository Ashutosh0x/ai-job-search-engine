"use client"
import { cn } from "@/lib/utils"
import { Marquee } from "@/components/magicui/marquee"
import { Quote } from "lucide-react"

type Review = {
  name: string
  username: string
  body: string
  img: string
  role?: string
  company?: string
}

// Realistic-looking avatars using randomuser photos
const reviews: Review[] = [
  {
    name: "John Doe",
    username: "Marketing Manager",
    role: "Marketing Manager",
    company: "",
    body:
      "This platform is incredibly intuitive and efficient, streamlining our workflow and boosting productivity. A must–have for any team!",
    img: "https://randomuser.me/api/portraits/men/32.jpg",
  },
  {
    name: "Savanah Wilson",
    username: "Blackrock Data Analyst",
    role: "Data Analyst",
    company: "Blackrock",
    body:
      "Every recruiter ghosted me before. This resume finally passed those evil ATS bots. Now I'm ghosting them instead.",
    img: "https://randomuser.me/api/portraits/women/65.jpg",
  },
  {
    name: "Krish Malhotra",
    username: "Junior DevOps Engineer",
    role: "Junior DevOps Engineer",
    company: "",
    body:
      "This app helped me build a resume that passed ATS filters and automatically applied to jobs I was qualified for. Got interview call within days.",
    img: "https://randomuser.me/api/portraits/men/76.jpg",
  },
  {
    name: "Michael Johnson",
    username: "Sales Head",
    role: "Sales Head",
    company: "",
    body:
      "Built my resume in minutes and applied in one click, got callbacks in 48 hours.",
    img: "https://randomuser.me/api/portraits/men/12.jpg",
  },
  {
    name: "Cristian Watson",
    username: "Intern — Deloitte",
    role: "Intern",
    company: "Deloitte",
    body:
      "The smart job matching found positions that perfectly fit my skills. I didn’t have to scroll endlessly — hours of work done by AI.",
    img: "https://randomuser.me/api/portraits/men/9.jpg",
  },
  {
    name: "Soni Patel",
    username: "Junior DevOps Engineer",
    role: "Junior DevOps Engineer",
    company: "",
    body:
      "It's like having a personal career assistant 24/7. My interview rate doubled in a week.",
    img: "https://randomuser.me/api/portraits/women/44.jpg",
  },
  {
    name: "Sheldon Holmes",
    username: "Freelancer",
    role: "Freelancer",
    company: "",
    body:
      "I’m too lazy to job hunt, so this app hunts for me. Literally working while I sleep.",
    img: "https://randomuser.me/api/portraits/men/41.jpg",
  },
]

const firstRow = reviews.slice(0, Math.ceil(reviews.length / 2))
const secondRow = reviews.slice(Math.ceil(reviews.length / 2))

function ReviewCard({ img, name, username, body }: Review) {
  return (
    <figure
      className={cn(
        "relative h-full w-72 cursor-pointer overflow-hidden rounded-2xl border p-6",
        "border-gray-200 bg-white/80 hover:bg-white dark:border-gray-700 dark:bg-gray-800/70 dark:hover:bg-gray-800",
        "shadow-sm"
      )}
    >
      <Quote className="absolute top-4 right-4 h-6 w-6 text-purple-300 dark:text-purple-400/60" />
      <div className="flex items-center gap-3">
        <img className="h-10 w-10 rounded-full object-cover" alt={name} src={img} />
        <div className="flex flex-col">
          <figcaption className="text-sm font-semibold text-gray-900 dark:text-white">{name}</figcaption>
          <p className="text-xs font-medium text-gray-500 dark:text-gray-400">{username}</p>
        </div>
      </div>
      <blockquote className="mt-3 text-sm leading-relaxed text-gray-700 dark:text-gray-300">
        “{body}”
      </blockquote>
      <Quote className="absolute -bottom-3 -left-3 h-10 w-10 rotate-180 text-purple-200/60 dark:text-purple-500/20" />
    </figure>
  )
}

export function TestimonialsMarquee() {
  return (
    <div className="relative w-full overflow-hidden rounded-2xl">
      <Marquee pauseOnHover className="[--duration:22s] py-2">
        {firstRow.map((r) => (
          <ReviewCard key={r.username} {...r} />
        ))}
      </Marquee>
      <Marquee reverse pauseOnHover className="[--duration:22s] py-2">
        {secondRow.map((r) => (
          <ReviewCard key={r.username} {...r} />
        ))}
      </Marquee>
      {/* Removed dark edge fades that appeared as black shades on the page */}
    </div>
  )
}

export default TestimonialsMarquee


