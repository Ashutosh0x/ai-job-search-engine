"use client"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import { Zap, Target, TrendingUp, ArrowRight, Sparkles, Sun, Moon, FileText, Chrome, Mail, User, Play, Download } from "lucide-react"
import Link from "next/link"
import { WordsPullUp } from "@/components/words-pull-up"
import Navigation from "@/components/navigation"
import AutoTypingSearch from "@/components/auto-typing-search"
import LogoMarquee from "@/components/logo-marquee"
import { useTheme } from "next-themes"
import { useEffect, useRef, useState } from "react"

// AI Resume Features Card Component
function AIFeatureCard({ icon: Icon, title, description, staggerClass }: {
  icon: any
  title: string
  description: string
  staggerClass: string
}) {
  const cardRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            entry.target.classList.add('fade-in-up')
            observer.unobserve(entry.target)
          }
        })
      },
      { threshold: 0.1 }
    )

    if (cardRef.current) {
      observer.observe(cardRef.current)
    }

    return () => observer.disconnect()
  }, [])

  return (
    <div
      ref={cardRef}
      className={`opacity-0 translate-y-5 ${staggerClass}`}
    >
      <Card className="h-full p-4 sm:p-6 lg:p-8 transition-all duration-500 hover:scale-105 hover:shadow-xl
                      bg-white/10 dark:bg-gray-800/20 backdrop-blur-md hover:bg-white/15 dark:hover:bg-gray-800/30
                      border border-purple-300/40 dark:border-gray-700/30 rounded-2xl shadow-xl group relative overflow-hidden hover:shadow-purple-400/20">
        {/* Subtle glow effect */}
        <div className="absolute inset-0 bg-gradient-to-br from-purple-200/30 via-pink-200/20 to-purple-100/10 dark:from-white/[0.02] pointer-events-none"></div>
        
        {/* Hover overlay effect */}
        <div className="absolute inset-0 opacity-0 group-hover:opacity-100 transition-opacity duration-500 pointer-events-none">
          <div className="absolute inset-0 bg-gradient-to-br from-purple-300/20 via-transparent to-pink-300/20 dark:from-slate-600/5 dark:via-transparent dark:to-slate-800/5 rounded-2xl"></div>
        </div>
        <CardContent className="p-0 space-y-4 relative z-10">
          <div className="mb-4 transition-transform duration-300 group-hover:scale-110 transform origin-left">
            <Icon className="h-8 w-8 text-purple-400 group-hover:text-pink-400 transition-all duration-300" />
          </div>
          <h3 className="text-xl font-bold mb-3 text-gray-900 dark:text-white transition-colors duration-300">
            {title}
          </h3>
          <p className="text-gray-600 dark:text-gray-300 mb-6 flex-grow text-sm leading-relaxed">
            {description}
          </p>
          
          {/* Visual element below description */}
          <div className="mt-auto">
            <div className="relative w-full h-32 bg-gradient-to-br from-purple-50/40 to-pink-50/30 dark:from-gray-800/50 dark:to-gray-900/50 rounded-lg border border-purple-200/40 dark:border-gray-700/50 p-3 overflow-hidden">
              <div className="flex items-center justify-between mb-2">
                {title.includes("ATS") && (
                  <div className="flex items-center space-x-2">
                    <div className="w-3 h-3 bg-green-500 rounded-full"></div>
                    <div className="w-3 h-3 bg-yellow-500 rounded-full"></div>
                    <div className="w-3 h-3 bg-red-500 rounded-full"></div>
                  </div>
                )}
                {title.includes("Generator") && (
                  <div className="flex items-center space-x-2">
                    <div className="w-4 h-4 bg-[#530fff] rounded"></div>
                    <div className="w-4 h-4 bg-blue-500 rounded"></div>
                    <div className="w-4 h-4 bg-green-500 rounded"></div>
                  </div>
                )}
                {title.includes("Chrome") && (
                  <div className="px-2 py-1 bg-red-500 text-white text-xs rounded font-mono">EXT</div>
                )}
                {title.includes("Mails") && (
                  <div className="flex items-center space-x-2">
                    <div className="w-3 h-3 bg-green-500 rounded-full"></div>
                    <div className="w-3 h-3 bg-yellow-500 rounded-full"></div>
                    <div className="w-3 h-3 bg-blue-500 rounded-full"></div>
                  </div>
                )}
                {title.includes("Personalization") && (
                  <div className="flex items-center space-x-2">
                    <div className="w-4 h-4 bg-[#530fff] rounded-full"></div>
                    <div className="w-4 h-4 bg-blue-500 rounded-full"></div>
                    <div className="w-4 h-4 bg-green-500 rounded-full"></div>
                  </div>
                )}
              </div>
              <div className="space-y-1">
                <div className="w-full h-px bg-purple-200/60 dark:bg-gray-600/50"></div>
                <div className="w-3/4 h-px bg-purple-200/60 dark:bg-gray-600/50"></div>
                <div className="w-1/2 h-px bg-purple-200/60 dark:bg-gray-600/50"></div>
              </div>
              <div className="absolute -bottom-2 -right-2 w-8 h-8 bg-pink-400/20 rounded-full blur-sm"></div>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}

// Demo Video Card Component (supports local video via videoSrc or YouTube via videoId)
function DemoVideoCard({ videoId, videoSrc, staggerClass = "stagger-6" }: { videoId?: string; videoSrc?: string; staggerClass?: string }) {
  const cardRef = useRef<HTMLDivElement>(null)
  const videoRef = useRef<HTMLVideoElement>(null)
  const [loadError, setLoadError] = useState(false)
  const [isPlaying, setIsPlaying] = useState(false)

  useEffect(() => {
    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            entry.target.classList.add('fade-in-up')
            observer.unobserve(entry.target)
          }
        })
      },
      { threshold: 0.1 }
    )

    if (cardRef.current) {
      observer.observe(cardRef.current)
    }

    return () => observer.disconnect()
  }, [])

  useEffect(() => {
    const el = videoRef.current
    if (!el) return
    const onPlay = () => setIsPlaying(true)
    const onPause = () => setIsPlaying(false)
    const onEnded = () => setIsPlaying(false)
    el.addEventListener('play', onPlay)
    el.addEventListener('pause', onPause)
    el.addEventListener('ended', onEnded)
    return () => {
      el.removeEventListener('play', onPlay)
      el.removeEventListener('pause', onPause)
      el.removeEventListener('ended', onEnded)
    }
  }, [videoRef.current])

  return (
    <div ref={cardRef} className={`opacity-0 translate-y-5 ${staggerClass}`}>
      {/* Simplified container: removed thick outer card */}
      <div className="relative">
        {/* Responsive video embed */}
        <div className="relative w-full overflow-hidden rounded-xl border border-purple-200/40 dark:border-gray-700/50 bg-gradient-to-br from-purple-50/40 to-pink-50/30">
          <div className="pt-[56.25%]"></div>
          {videoSrc ? (
            <video
              className="absolute inset-0 w-full h-full rounded-xl"
              ref={videoRef}
              preload="metadata"
              playsInline
              muted
              disablePictureInPicture
              controlsList="nodownload noplaybackrate nofullscreen"
              onError={() => setLoadError(true)}
            >
              <source src={typeof window !== 'undefined' ? encodeURI(videoSrc) : videoSrc} type="video/mp4" />
            </video>
          ) : (
            <iframe
              className="absolute inset-0 w-full h-full rounded-xl"
              src={`https://www.youtube.com/embed/${videoId}?rel=0&modestbranding=1`}
              title="Product demo"
              allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
              allowFullScreen
            />
          )}
          {videoSrc && (
            <div className={`absolute inset-0 flex items-center justify-center transition-opacity duration-200 ${isPlaying ? 'opacity-0 pointer-events-none' : 'opacity-100'}`}>
              <button
                type="button"
                aria-label="Play demo video"
                className="pointer-events-auto w-16 h-16 rounded-full bg-black/30 backdrop-blur-sm border border-white/40 text-white flex items-center justify-center shadow-lg hover:bg-black/40 transition-transform duration-200 hover:scale-105"
                onClick={() => videoRef.current?.play()}
              >
                <Play className="w-8 h-8" />
              </button>
            </div>
          )}
          {loadError && (
            <div className="absolute inset-0 flex items-center justify-center text-sm text-gray-700 dark:text-gray-300 bg-white/60 dark:bg-black/40">
              Video not found. Place file in public/demo/resume-demo-video.mp4
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

export default function LandingPage() {
  const { setTheme, theme } = useTheme()
  // Rotating focus across headline words
  const focusTokensRef = useRef<Array<{ text: string; gradient?: boolean }>>([
    { text: 'Find' },
    { text: 'Your' },
    { text: 'Dream' },
    { text: 'Job' },
    { text: 'with' },
    { text: 'AI', gradient: true },
    { text: 'Power', gradient: true },
  ])
  const [focusIndex, setFocusIndex] = useState(0)
  useEffect(() => {
    const intervalId = window.setInterval(() => {
      setFocusIndex((prev) => (prev + 1) % focusTokensRef.current.length)
    }, 1600)
    return () => window.clearInterval(intervalId)
  }, [])
  // Note: TrueFocus remote module references React internals and cannot be imported directly in the browser.
  // We keep a CSS fallback glow on the target word instead.

  return (
    <div className="min-h-screen">
      {/* Navigation */}
      <Navigation />

      {/* Hero Section */}
      <div className="pt-4 sm:pt-8">
        <section className="max-w-7xl mx-auto px-4 sm:px-6 py-12 sm:py-20">
          <div className="text-center space-y-6 sm:space-y-8">
            <div className="space-y-4">
              <h1 className="text-3xl sm:text-4xl md:text-5xl lg:text-7xl font-bold text-gray-900 dark:text-white leading-tight">
                {focusTokensRef.current.map((tok, idx) => {
                  const gradientClass = tok.gradient ? 'bg-gradient-to-r from-purple-400 to-pink-400 bg-clip-text text-transparent' : ''
                  const isFocus = idx === focusIndex
                  return (
                    <span key={idx} className="inline-block">
                      {isFocus ? (
                        <span className="focus-brackets">
                          <span className={"focus-word " + gradientClass}>{tok.text}</span>
                          <span aria-hidden className="corner tl"></span>
                          <span aria-hidden className="corner tr"></span>
                          <span aria-hidden className="corner bl"></span>
                          <span aria-hidden className="corner br"></span>
                        </span>
                      ) : (
                        <span className={"truefocus-blur " + gradientClass}>{tok.text}</span>
                      )}
                      {idx < focusTokensRef.current.length - 1 ? ' ' : ''}
                </span>
                  )
                })}
              </h1>
              <p className="text-lg sm:text-xl text-gray-600 dark:text-gray-300 max-w-3xl mx-auto leading-relaxed px-4">
                Leverage cutting-edge AI to optimize your resume, discover perfect job matches, and automate your
                application process. Land your next role faster than ever.
              </p>
            </div>

            {/* Auto-Typing Search Demo */}
            <div className="py-6 sm:py-8">
              {/* Assuming AutoTypingSearch is designed to take a placeholder prop if needed,
                  otherwise, it will use its internal phrases. */}
              <AutoTypingSearch />
            </div>

            <div className="flex flex-col sm:flex-row gap-4 justify-center items-center px-4">
              <Link href="/dashboard" className="relative inline-block w-full sm:w-auto">
                <span
                  className="relative inline-flex items-center justify-center gap-2 rounded-full border border-[#E9E7FF] bg-gradient-to-b from-white to-[#F7F5FF] px-6 sm:px-8 py-3 sm:py-4 text-base sm:text-lg font-medium text-[#6B5BFF] shadow-[inset_0_1px_0_#FFFFFF] transition-all duration-200 hover:shadow-md dark:border-gray-600 dark:from-gray-100 dark:to-gray-200 dark:text-gray-800 dark:shadow-[inset_0_1px_0_rgba(0,0,0,0.1)]"
                >
                  <Sparkles className="h-5 w-5 text-[#6B5BFF] dark:text-gray-700" />
                  <span>Get Started</span>
                </span>
                <span className="pointer-events-none absolute -bottom-2 left-1/2 h-3 w-36 -translate-x-1/2 rounded-full bg-black/15 dark:bg-gray-400/20 blur-md" />
              </Link>

              <Link href="/extension" className="relative inline-block w-full sm:w-auto">
                <span
                  className="relative inline-flex items-center justify-center gap-2 rounded-full border border-[#E9E7FF] bg-gradient-to-b from-white to-[#F7F5FF] px-6 sm:px-8 py-3 sm:py-4 text-base sm:text-lg font-medium text-[#6B5BFF] shadow-[inset_0_1px_0_#FFFFFF] transition-all duration-200 hover:shadow-md dark:border-gray-600 dark:from-gray-100 dark:to-gray-200 dark:text-gray-800 dark:shadow-[inset_0_1px_0_rgba(0,0,0,0.1)]"
                >
                  <Download className="h-5 w-5 text-[#6B5BFF] dark:text-gray-700" />
                  <span>Download Extension</span>
                </span>
                <span className="pointer-events-none absolute -bottom-2 left-1/2 h-3 w-36 -translate-x-1/2 rounded-full bg-black/15 dark:bg-gray-400/20 blur-md" />
              </Link>
            </div>

            {/* Demo Video Card under Hero CTA */}
            <div className="max-w-3xl mx-auto mt-8 sm:mt-10 px-4">
              <DemoVideoCard videoSrc="/demo/resume.mp4" />
            </div>

            {/* Logos Marquee */}
            <div className="mt-10 sm:mt-14 px-0">
              <LogoMarquee className="py-6" />
            </div>
          </div>

          {/* Floating Feature Cards */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6 sm:gap-8 mt-12 sm:mt-20 px-4">
            {/* Card 1: AI Resume Optimization - Applied blur effect */}
            <Card className="p-4 sm:p-6 transition-transform duration-300
                            bg-white/20 dark:bg-gray-800/20 backdrop-blur-lg border border-white/30 dark:border-gray-700/30 rounded-lg">
              <CardContent className="p-0 space-y-4">
                <div className="w-12 h-12 bg-purple-600/20 rounded-lg flex items-center justify-center">
                  <Zap className="w-6 h-6 text-purple-400" />
                </div>
                <h3 className="text-lg sm:text-xl font-semibold text-gray-900 dark:text-white">
                  AI Resume Optimization
                </h3>
                <p className="text-sm sm:text-base text-gray-600 dark:text-gray-300"> {/* Changed text-gray-400 to text-gray-300 for better visibility on blurred background in dark mode */}
                  Get instant ATS feedback and optimization suggestions to make your resume stand out.
                </p>
              </CardContent>
            </Card>

            {/* Card 2: Smart Job Matching - Applied blur effect */}
            <Card className="p-4 sm:p-6 transition-transform duration-300
                            bg-white/20 dark:bg-gray-800/20 backdrop-blur-lg border border-white/30 dark:border-gray-700/30 rounded-lg">
              <CardContent className="p-0 space-y-4">
                <div className="w-12 h-12 bg-purple-600/20 rounded-lg flex items-center justify-center">
                  <Target className="w-6 h-6 text-purple-400" />
                </div>
                <h3 className="text-lg sm:text-xl font-semibold text-gray-900 dark:text-white">Smart Job Matching</h3>
                <p className="text-sm sm:text-base text-gray-600 dark:text-gray-300"> {/* Changed text-gray-400 to text-gray-300 */}
                  Our AI analyzes your skills and preferences to find the perfect job opportunities.
                </p>
              </CardContent>
            </Card>

            {/* Card 3: Auto-Apply System - Applied blur effect */}
            <Card className="p-4 sm:p-6 transition-transform duration-300
                            bg-white/20 dark:bg-gray-800/20 backdrop-blur-lg border border-white/30 dark:border-gray-700/30 rounded-lg">
              <CardContent className="p-0 space-y-4">
                <div className="w-12 h-12 bg-purple-600/20 rounded-lg flex items-center justify-center">
                  <TrendingUp className="w-6 h-6 text-purple-400" />
                </div>
                <h3 className="text-lg sm:text-xl font-semibold text-gray-900 dark:text-white">Auto-Apply System</h3>
                <p className="text-sm sm:text-base text-gray-600 dark:text-gray-300"> {/* Changed text-gray-400 to text-gray-300 */}
                  Automatically apply to relevant positions while you focus on interview preparation.
                </p>
              </CardContent>
            </Card>
          </div>
        </section>
      </div>

      {/* Get Started - AI Resume Features Section */}
      <section className="py-20 sm:py-32 bg-white dark:bg-gray-950 relative overflow-hidden">
        {/* Background decoration */}
        <div className="absolute inset-0 bg-gradient-to-br from-purple-400/10 via-transparent to-pink-400/10 pointer-events-none"></div>
        <div className="absolute top-0 left-1/4 w-72 h-72 bg-purple-400/20 dark:bg-purple-500/15 rounded-full blur-3xl pointer-events-none animate-pulse"></div>
        <div className="absolute bottom-0 right-1/4 w-96 h-96 bg-pink-400/20 dark:bg-pink-500/15 rounded-full blur-3xl pointer-events-none animate-pulse" style={{ animationDelay: '2s' }}></div>
        <div className="max-w-7xl mx-auto px-4 sm:px-6">
          <div className="text-center mb-16 sm:mb-20 space-y-6">
            <WordsPullUp
              text="Get Started with AI Resume"
              className="text-gray-900 dark:text-white"
            />
            <WordsPullUp
              text="Transform your job search with our comprehensive AI-powered resume and application tools"
              className="!text-base sm:!text-xl md:!text-2xl !font-normal text-gray-600 dark:text-gray-300 md:!leading-9"
            />
            <div className="w-24 h-1 bg-gradient-to-r from-purple-400 to-pink-400 mx-auto rounded-full"></div>
          </div>

          {/* AI Resume Features Grid */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6 sm:gap-8 max-w-6xl mx-auto px-4 sm:px-0">
            <AIFeatureCard
              icon={FileText}
              title="AI Resume ATS & ATS Check with JD"
              description="Automatically optimize resumes to pass ATS filters by matching job descriptions."
              staggerClass="stagger-1"
            />
            <AIFeatureCard
              icon={Sparkles}
              title="Resume & CV Generator"
              description="Create professional resumes and CVs in seconds with AI-powered templates."
              staggerClass="stagger-2"
            />
            <AIFeatureCard
              icon={Chrome}
              title="Auto Apply Using Chrome Extension"
              description="Instantly apply to multiple jobs with one click from your browser."
              staggerClass="stagger-3"
            />
            <AIFeatureCard
              icon={Mail}
              title="Send Mails to Recruiters Automatically"
              description="Reach recruiters directly with personalized AI-generated emails."
              staggerClass="stagger-4"
            />
            <AIFeatureCard
              icon={User}
              title="Career Level Personalization"
              description="Tailor resume suggestions based on career stage, experience, and goals."
              staggerClass="stagger-5"
            />
          </div>

          

          {/* CTA Button */}
          <div className="text-center mt-16 sm:mt-20">
            <Link href="/dashboard">
              <Button className="text-lg px-8 py-4 bg-gradient-to-r from-purple-500 to-pink-500 hover:from-purple-500/90 hover:to-pink-500/90 text-white font-semibold rounded-xl shadow-lg hover:shadow-xl transition-all duration-300 hover:scale-105">
                Start Building Your AI Resume <ArrowRight className="ml-2 w-5 h-5" />
              </Button>
            </Link>
          </div>
        </div>
      </section>

      {/* Newsletter Section */}
      <section className="bg-gray-900 dark:bg-gray-950 py-12 sm:py-16">
        <div className="max-w-7xl mx-auto px-4 sm:px-6">
          <div className="flex flex-col lg:flex-row items-center justify-between gap-6 sm:gap-8">
            <div className="text-center lg:text-left">
              <h2 className="text-2xl sm:text-3xl font-bold text-white mb-4">Stay Ahead of the AI Curve</h2>
              <p className="text-gray-400 text-base sm:text-lg max-w-md">
                Join our newsletter for exclusive insights and updates on the latest AI trends.
              </p>
            </div>

            <div className="flex flex-col sm:flex-row items-center space-y-4 sm:space-y-0 sm:space-x-4 w-full lg:w-auto">
              <div className="relative w-full lg:w-auto">
                <input
                  type="email"
                  placeholder="john@gmail.com"
                  className="w-full lg:w-80 px-4 sm:px-6 py-3 sm:py-4 bg-gray-800 border border-gray-700 rounded-full text-white placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-purple-500 focus:border-transparent"
                />
              </div>
              <Button className="bg-white hover:bg-gray-100 text-gray-900 font-medium px-6 sm:px-8 py-3 sm:py-4 rounded-full transition-all duration-200 w-full sm:w-auto">
                Submit
              </Button>
            </div>
          </div>
        </div>
      </section>

      {/* Footer */}
      <footer className="bg-gray-950 border-t border-gray-800 py-8 sm:py-12">
        <div className="max-w-7xl mx-auto px-4 sm:px-6">
          <div className="flex flex-col lg:flex-row items-center justify-between gap-6 sm:gap-8">
            {/* Left side - Logo and Links */}
            <div className="flex flex-col lg:flex-row items-center space-y-4 lg:space-y-0 lg:space-x-12">
              <Link href="/" className="flex items-center space-x-2">
                <div className="w-8 h-8 bg-gradient-to-br from-purple-500 to-pink-500 rounded-lg flex items-center justify-center">
                  <Sparkles className="w-5 h-5 text-white" />
                </div>
              </Link>

              <div className="flex flex-wrap items-center justify-center gap-4 sm:gap-8 text-sm">
                <Link href="/docs" className="text-gray-400 hover:text-white transition-colors">
                  Docs
                </Link>
                <Link href="/help" className="text-gray-400 hover:text-white transition-colors">
                  Help
                </Link>
                <Link href="/privacy" className="text-gray-400 hover:text-white transition-colors">
                  Privacy Policy
                </Link>
                <Link href="/terms" className="text-gray-400 hover:text-white transition-colors">
                  Terms
                </Link>
              </div>
            </div>

            {/* Right side - Appearance toggle and Social Icons */}
            <div className="flex flex-col sm:flex-row items-center space-y-4 sm:space-y-0 sm:space-x-6">
              <div className="flex items-center space-x-2 text-gray-400 text-sm">
                <span>Appearance</span>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setTheme(theme === "dark" ? "light" : "dark")}
                  className="text-gray-400 hover:text-white p-2"
                >
                  <Sun className="h-4 w-4 rotate-0 scale-100 transition-all dark:-rotate-90 dark:scale-0" />
                  <Moon className="absolute h-4 w-4 rotate-90 scale-0 transition-all dark:rotate-0 dark:scale-100" />
                </Button>
              </div>

              <div className="flex items-center space-x-4">
                <Link
                  href="https://github.com"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-gray-400 hover:text-white transition-colors"
                >
                  <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 24 24">
                    <path d="M12 0c-6.626 0-12 5.373-12 12 0 5.302 3.438 9.8 8.207 11.387.599.111.793-.261.793-.577v-2.234c-3.338.726-4.033-1.416-4.033-1.416-.546-1.387-1.333-1.756-1.333-1.756-1.089-.745.083-.729.083-.729 1.205.084 1.839 1.237 1.839 1.237 1.07 1.834 2.807 1.304 3.492.997.107-.775.418-1.305.762-1.604-2.665-.305-5.467-1.334-5.467-5.931 0-1.311.469-2.381 1.236-3.221-.124-.303-.535-1.524.117-3.176 0 0 1.008-.322 3.301 1.23.957-.266 1.983-.399 3.003-.404 1.02.005 2.047.138 3.006.404 2.291-1.552 3.297-1.23 3.297-1.23.653 1.653.242 2.874.118 3.176.77.84 1.235 1.911 1.235 3.221 0 4.609-2.807 5.624-5.479 5.921.43.372.823 1.102.823 2.222v3.293c0 .319.192.694.801.576 4.765-1.589 8.199-6.086 8.199-11.386 0-6.627-5.373-12-12-12z" />
                  </svg>
                </Link>

                <Link
                  href="https://twitter.com"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-gray-400 hover:text-white transition-colors"
                >
                  <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 24 24">
                    <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z" />
                  </svg>
                </Link>

                <Link
                  href="https://discord.com"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-gray-400 hover:text-white transition-colors"
                >
                  <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 24 24">
                    <path d="M20.317 4.3698a19.7913 19.7913 0 00-4.8851-1.5152.0741.0741 0 00-.0785.0371c-.211.3753-.4447.8648-.6083 1.2495-1.8447-.2762-3.68-.2762-5.4868 0-.1636-.3933-.4058-.8742-.6177-1.2495a.077.077 0 00-.0785-.037 19.7363 19.7363 0 00-4.8852 1.515.0699.0699 0 00-.0321.0277C.5334 9.0458-.319 13.5799.0992 18.0578a.0824.0824 0 00.0312.0561c2.0528 1.5076 4.0413 2.4228 5.9929 3.0294a.0777.0777 0 00.0842-.0276c.4616-.6304.8731-1.2952 1.226-1.9942a.076.076 0 00-.0416-.1057c-.6528-.2476-1.2743-.5495-1.8722-.8923a.077.077 0 01-.0076-.1277c.1258-.0943.2517-.1923.3718-.2914a.0743.0743 0 01.0776-.0105c3.9278 1.7933 8.18 1.7933 12.0614 0a.0739.0739 0 01.0785.0095c.1202.099.246.1981.3728.2924a.077.077 0 01-.0066.1276 12.2986 12.2986 0 01-1.873.8914.0766.0766 0 00-.0407.1067c.3604.698.7719 1.3628 1.225 1.9932a.076.076 0 00.0842.0286c1.961-.6067 3.9495-1.5219 6.0023-3.0294a.077.077 0 00.0313-.0552c.5004-5.177-.8382-9.6739-3.5485-13.6604a.061.061 0 00-.0312-.0286zM8.02 15.3312c-1.1825 0-2.1569-1.0857-2.1569-2.419 0-1.3332.9555-2.4189 2.157-2.4189 1.2108 0 2.1757 1.0952 2.1568 2.419-.0002 1.3332-.9555 2.4189-2.1569 2.4189zm7.9748 0c-1.1825 0-2.1569-1.0857-2.1569-2.419 0-1.3332.9554-2.4189 2.1569-2.4189 1.2108 0 2.1757 1.0952 2.1568 2.419 0 1.3332-.9554 2.4189-2.1568 2.4189Z" />
                  </svg>
                </Link>
              </div>
            </div>
          </div>

          {/* Copyright */}
          <div className="mt-6 sm:mt-8 pt-6 sm:pt-8 border-t border-gray-800 text-center">
            <p className="text-gray-400 text-sm">© 2025 JobSpark AI. All rights reserved.</p>
          </div>
        </div>
      </footer>
    </div>
  )
}