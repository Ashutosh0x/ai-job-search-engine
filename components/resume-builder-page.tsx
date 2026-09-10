"use client"

import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Star, ChevronLeft, ChevronRight, Sparkles } from "lucide-react"
import Navigation from "@/components/navigation"
import { useState, useEffect } from "react"
import { motion } from "framer-motion"
import TestimonialsMarquee from "@/components/testimonials-marquee"
import Lottie from "lottie-react"

export default function ResumeBuilderPage() {
  const [currentTestimonial, setCurrentTestimonial] = useState(0)
  const [ctcAnim, setCtcAnim] = useState<any | null>(null)

  useEffect(() => {
    let isMounted = true
    fetch('/resumeCTC.json')
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (isMounted) setCtcAnim(data)
      })
      .catch(() => {})
    return () => {
      isMounted = false
    }
  }, [])

  const testimonials = [
    {
      name: "Emmanuel",
      role: "Software Engineer",
      company: "Polydelta",
      companyLogo: "🚀",
      avatar: "👨🏽‍💻",
      quote: "I found a ton of exciting roles at startups I'd never heard of with Simplify!",
    },
    {
      name: "Grace",
      role: "Associate Product Manager",
      company: "Google",
      companyLogo: "🔍",
      avatar: "👩🏻‍💼",
      quote:
        "Simplify notified me about Google's APM program the day it opened which was crucial in landing the offer!",
    },
    {
      name: "Harshit",
      role: "Principal TPM",
      company: "Meta",
      companyLogo: "📘",
      avatar: "👨🏾‍💼",
      quote: "Simplify made it easy to find senior positions I that fit my requirements and qualifications!",
    },
    {
      name: "Albert",
      role: "Software Engineer",
      company: "Jane Street",
      companyLogo: "💼",
      avatar: "👨🏻‍💻",
      quote: "I love the curated job lists. Makes it super easy to find roles in specific industries!",
    },
  ]

  const companyLogos = [
    { name: "SpaceX", logo: "🚀" },
    { name: "Discord", logo: "🎮" },
    { name: "Notion", logo: "📝" },
    { name: "Canva", logo: "🎨" },
    { name: "Duolingo", logo: "🦉" },
    { name: "Netflix", logo: "🎬" },
    { name: "Instacart", logo: "🛒" },
    { name: "Visa", logo: "💳" },
    { name: "Capital One", logo: "🏦" },
  ]

  const nextTestimonial = () => {
    setCurrentTestimonial((prev) => (prev + 1) % testimonials.length)
  }

  const prevTestimonial = () => {
    setCurrentTestimonial((prev) => (prev - 1 + testimonials.length) % testimonials.length)
  }

  return (
    <>
      <Navigation />
      <div className="min-h-screen bg-gradient-to-br from-gray-50 via-purple-50/20 to-gray-50 dark:from-gray-900 dark:via-purple-900/20 dark:to-gray-900">
        {/* Hero Section */}
        <section className="max-w-7xl mx-auto px-6 py-20">
          <div className="grid lg:grid-cols-2 gap-12 items-center">
            <div className="space-y-8">
              <div className="space-y-6">
                <h1 className="text-5xl md:text-6xl font-bold text-gray-900 dark:text-white leading-tight">
                  Build the best resume. <span className="text-gray-700 dark:text-gray-300">Get more offers.</span>
                </h1>
                <p className="text-xl text-gray-600 dark:text-gray-400 leading-relaxed">
                  Craft tailored AI resumes, identify keywords missing and get personalized tips on how to optimize your
                  resume, all in a few clicks.
                </p>
              </div>

              <div className="relative inline-block">
                <button
                  className="relative inline-flex items-center gap-2 rounded-full border border-[#E9E7FF] bg-gradient-to-b from-white to-[#F7F5FF] px-8 py-4 text-lg font-medium text-[#6B5BFF] shadow-[inset_0_1px_0_#FFFFFF] transition-all duration-200 hover:shadow-md dark:border-gray-600 dark:from-gray-100 dark:to-gray-200 dark:text-gray-800 dark:shadow-[inset_0_1px_0_rgba(0,0,0,0.1)]"
                >
                  <Sparkles className="h-5 w-5 text-[#6B5BFF] dark:text-gray-700" />
                  <span>Sign up for free</span>
                </button>
                <div className="pointer-events-none absolute -bottom-2 left-1/2 h-3 w-40 -translate-x-1/2 rounded-full bg-black/15 dark:bg-gray-400/20 blur-md" />
              </div>

              <div className="flex items-center space-x-2">
                <div className="flex">
                  {[...Array(5)].map((_, i) => (
                    <Star key={i} className="w-5 h-5 fill-yellow-400 text-yellow-400" />
                  ))}
                </div>
                <span className="text-gray-600 dark:text-gray-400">
                  Join over 1,000,000 job seekers who use JobSpark AI
                </span>
              </div>
            </div>

            <div className="relative">
              {/* CTC Widget - exact SVG render (top-right above the card) */}
              <div className="absolute -top-[200px] md:-top-[140px] lg:-top-[80px] xl:-top-[50px] -right-8 md:-right-14 lg:-right-20 hidden sm:block z-30 pointer-events-none">
                {/* If resume-ctc.json exists in /public, we'll animate it. Otherwise, fall back to the static SVG. */}
                {ctcAnim ? (
                  <Lottie
                    animationData={ctcAnim}
                    renderer="svg"
                    rendererSettings={{ preserveAspectRatio: 'xMidYMid meet', progressiveLoad: true, hideOnTransparent: true }}
                    loop
                    autoplay
                    className="w-80 md:w-[28rem] lg:w-[34rem] xl:w-[40rem] h-auto"
                  />
                ) : (
                  <motion.img
                    src="/resumeCTC.svg"
                    alt="Resume CTC section"
                    className="w-80 md:w-[28rem] lg:w-[34rem] xl:w-[40rem] h-auto"
                    animate={{ y: [0, -20, 0], rotate: [0, -3, 0], scale: [1, 1.02, 1] }}
                    transition={{ duration: 6, repeat: Infinity, ease: "easeInOut" }}
                  />
                )}
                {/* Floating overlay cards */}
                <div className="relative w-0 h-0">
                  {/* Lightweight overlay badges (not exact UI, but animated float to simulate activity) */}
                  <div className="absolute inset-0">
                    
                  </div>
                </div>
              </div>
              <div className="bg-white dark:bg-gray-800 rounded-xl shadow-2xl p-6 border border-gray-200 dark:border-gray-700 mt-[412px] md:mt-[460px] lg:mt-[524px] xl:mt-[556px]">
                <div className="flex items-center justify-between mb-6">
                  <div className="flex items-center space-x-2">
                    <div className="w-3 h-3 bg-red-500 rounded-full"></div>
                    <div className="w-3 h-3 bg-yellow-500 rounded-full"></div>
                    <div className="w-3 h-3 bg-green-500 rounded-full"></div>
                  </div>
                  <div className="text-sm text-gray-500">Resume Analysis</div>
                </div>

                <div className="space-y-4">
                  <div className="flex items-center justify-between">
                    <span className="text-gray-700 dark:text-gray-300">Keyword Match</span>
                    <Badge className="bg-teal-500 text-white">Strong</Badge>
                  </div>
                  <div className="w-full bg-gray-200 dark:bg-gray-700 rounded-full h-2">
                    <div className="bg-teal-500 h-2 rounded-full w-4/5"></div>
                  </div>

                  <div className="grid grid-cols-2 gap-4 mt-6">
                    <div className="space-y-2">
                      <div className="text-sm text-gray-500">Missing Keywords</div>
                      <div className="flex flex-wrap gap-1">
                        <Badge variant="outline" className="text-xs">
                          React
                        </Badge>
                        <Badge variant="outline" className="text-xs">
                          TypeScript
                        </Badge>
                      </div>
                    </div>
                    <div className="space-y-2">
                      <div className="text-sm text-gray-500">ATS Score</div>
                      <div className="text-2xl font-bold text-teal-500">85%</div>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>

          
        </section>

        {/* AI Resume Tips Section */}
        <section className="bg-gray-100 dark:bg-gray-800/50 py-20">
          <div className="max-w-7xl mx-auto px-6">
            <div className="grid lg:grid-cols-2 gap-12 items-center">
              <div className="space-y-6">
                <h2 className="text-4xl font-bold text-gray-900 dark:text-white">
                  Get personalized resume tips from JobSpark's AI
                </h2>
                <p className="text-lg text-gray-600 dark:text-gray-400">
                  We trained an AI on recruiter-approved resumes to give you targeted suggestions and tips for every job
                  you apply to.
                </p>
                <Button className="bg-teal-500 hover:bg-teal-600 text-white font-medium px-6 py-3 rounded-full">
                  See AI Suggestions
                </Button>
              </div>

              <div className="relative">
                <div className="bg-white dark:bg-gray-800 rounded-xl shadow-2xl p-6 border border-gray-200 dark:border-gray-700">
                  <div className="flex items-center justify-between mb-6">
                    <div className="flex items-center space-x-2">
                      <div className="w-3 h-3 bg-red-500 rounded-full"></div>
                      <div className="w-3 h-3 bg-yellow-500 rounded-full"></div>
                      <div className="w-3 h-3 bg-green-500 rounded-full"></div>
                    </div>
                  </div>

                  <div className="space-y-6">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center space-x-3">
                        <div className="w-8 h-8 bg-teal-100 dark:bg-teal-900/30 rounded-full flex items-center justify-center">
                          <span className="text-teal-600 dark:text-teal-400 text-sm">📊</span>
                        </div>
                        <div>
                          <div className="font-medium text-gray-900 dark:text-white">Resume Score</div>
                          <div className="text-sm text-gray-500">View 12 issues found</div>
                        </div>
                      </div>
                      <div className="text-2xl font-bold text-teal-500">75</div>
                    </div>

                    <div className="flex items-center justify-between">
                      <div className="flex items-center space-x-3">
                        <div className="w-8 h-8 bg-blue-100 dark:bg-blue-900/30 rounded-full flex items-center justify-center">
                          <span className="text-blue-600 dark:text-blue-400 text-sm">🎯</span>
                        </div>
                        <div>
                          <div className="font-medium text-gray-900 dark:text-white">Keyword Match</div>
                          <div className="text-sm text-gray-500">Strong - 4 out of 5</div>
                        </div>
                      </div>
                    </div>

                    <div className="space-y-3">
                      <div className="font-medium text-gray-900 dark:text-white">Professional Experience</div>
                      <div className="space-y-2">
                        <div className="text-sm text-gray-600 dark:text-gray-400">Software Engineer</div>
                        <div className="flex flex-wrap gap-2">
                          <Badge className="bg-teal-500 text-white text-xs">Lead Generation</Badge>
                          <Badge className="bg-teal-500 text-white text-xs">Negotiation</Badge>
                          <Badge className="bg-teal-500 text-white text-xs">Market Research</Badge>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* Missing Keywords Section */}
        <section className="py-20">
          <div className="max-w-7xl mx-auto px-6">
            <div className="grid lg:grid-cols-2 gap-12 items-center">
              <div className="relative">
                <div className="bg-white dark:bg-gray-800 rounded-xl shadow-2xl p-6 border border-gray-200 dark:border-gray-700">
                  <div className="flex items-center justify-between mb-6">
                    <div className="flex items-center space-x-2">
                      <div className="w-3 h-3 bg-red-500 rounded-full"></div>
                      <div className="w-3 h-3 bg-yellow-500 rounded-full"></div>
                      <div className="w-3 h-3 bg-green-500 rounded-full"></div>
                    </div>
                  </div>

                  <div className="space-y-6">
                    <div className="flex items-center space-x-3">
                      <div className="w-10 h-10 bg-green-500 rounded-full flex items-center justify-center">
                        <span className="text-white font-bold">S</span>
                      </div>
                      <div>
                        <div className="font-medium text-gray-900 dark:text-white">Sales Branch Manager</div>
                        <div className="text-sm text-gray-500">Spotify</div>
                      </div>
                    </div>

                    <div className="space-y-3">
                      <div className="flex flex-wrap gap-2">
                        <Badge className="bg-teal-500 text-white">Lead Generation</Badge>
                        <Badge className="bg-teal-500 text-white">Negotiation</Badge>
                        <Badge className="bg-teal-500 text-white">Market Research</Badge>
                        <Badge className="bg-teal-500 text-white">Competitive Analysis</Badge>
                        <Badge className="bg-teal-500 text-white">Sales</Badge>
                      </div>
                    </div>

                    <div className="flex items-center justify-between">
                      <div className="flex items-center space-x-3">
                        <div className="w-8 h-8 bg-teal-100 dark:bg-teal-900/30 rounded-full flex items-center justify-center">
                          <span className="text-teal-600 dark:text-teal-400 text-sm">🎯</span>
                        </div>
                        <div>
                          <div className="font-medium text-gray-900 dark:text-white">Keyword Match</div>
                          <div className="text-sm text-gray-500">Strong - 4 out of 5 keywords found</div>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              </div>

              <div className="space-y-6">
                <h2 className="text-4xl font-bold text-gray-900 dark:text-white">
                  See important keywords missing in your resume
                </h2>
                <p className="text-lg text-gray-600 dark:text-gray-400">
                  JobSpark highlights the most important keywords in the job description you're applying to and uses AI
                  to help you naturally incorporate them into your resume.
                </p>
                <Button className="bg-teal-500 hover:bg-teal-600 text-white font-medium px-6 py-3 rounded-full">
                  View Missing Keywords
                </Button>
              </div>
            </div>
          </div>
        </section>

        {/* ATS Resume Builder Section */}
        <section className="bg-gray-100 dark:bg-gray-800/50 py-20">
          <div className="max-w-7xl mx-auto px-6 text-center">
            <div className="space-y-6 mb-16">
              <h2 className="text-4xl md:text-5xl font-bold text-gray-900 dark:text-white">
                Create the perfect resume with JobSpark's{" "}
                <span className="relative">
                  AI builder.
                  <div className="absolute -bottom-2 left-0 right-0 h-1 bg-teal-400 rounded"></div>
                </span>
              </h2>
              <p className="text-lg text-gray-600 dark:text-gray-400 max-w-3xl mx-auto">
                JobSpark users have created over 2 million resumes and applied to more than 40+ million jobs. In just
                this year.
              </p>
            </div>

            <div className="grid lg:grid-cols-2 gap-12 items-center">
              <div className="space-y-6 text-left">
                <h3 className="text-3xl font-bold text-gray-900 dark:text-white">
                  Build and optimize an ATS-friendly resume
                </h3>
                <p className="text-lg text-gray-600 dark:text-gray-400">
                  Our AI resume builder analyzes the job you're applying for and shows you a resume score that you can
                  optimize
                </p>
                <Button className="bg-teal-500 hover:bg-teal-600 text-white font-medium px-6 py-3 rounded-full">
                  Tailor Your Resume
                </Button>
              </div>

              <div className="relative">
                <div className="bg-white dark:bg-gray-800 rounded-xl shadow-2xl p-6 border border-gray-200 dark:border-gray-700">
                  <div className="flex items-center justify-between mb-6">
                    <div className="flex items-center space-x-2">
                      <div className="w-3 h-3 bg-red-500 rounded-full"></div>
                      <div className="w-3 h-3 bg-yellow-500 rounded-full"></div>
                      <div className="w-3 h-3 bg-green-500 rounded-full"></div>
                    </div>
                  </div>

                  <div className="space-y-6">
                    <div className="flex items-center space-x-3">
                      <div className="w-10 h-10 bg-red-500 rounded-full flex items-center justify-center">
                        <span className="text-white font-bold">C</span>
                      </div>
                      <div>
                        <div className="font-medium text-gray-900 dark:text-white">Sales Branch Manager</div>
                        <div className="text-sm text-gray-500">Capital One</div>
                      </div>
                    </div>

                    <div className="space-y-4">
                      <div className="flex items-center justify-between">
                        <div className="flex items-center space-x-3">
                          <div className="w-8 h-8 bg-teal-100 dark:bg-teal-900/30 rounded-full flex items-center justify-center">
                            <span className="text-teal-600 dark:text-teal-400 text-sm">📊</span>
                          </div>
                          <div>
                            <div className="font-medium text-gray-900 dark:text-white">Resume Score</div>
                            <div className="text-sm text-gray-500">View 12 issues found</div>
                          </div>
                        </div>
                        <div className="text-2xl font-bold text-teal-500">75</div>
                      </div>

                      <div className="space-y-3">
                        <div className="font-medium text-gray-900 dark:text-white">Get Feedback On</div>
                        <div className="space-y-2">
                          <div className="flex items-center space-x-2">
                            <div className="w-4 h-4 bg-blue-500 rounded"></div>
                            <span className="text-sm text-gray-600 dark:text-gray-400">Content Strength</span>
                          </div>
                          <div className="flex items-center space-x-2">
                            <div className="w-4 h-4 bg-green-500 rounded"></div>
                            <span className="text-sm text-gray-600 dark:text-gray-400">Formatting Optimization</span>
                          </div>
                          <div className="flex items-center space-x-2">
                            <div className="w-4 h-4 bg-purple-500 rounded"></div>
                            <span className="text-sm text-gray-600 dark:text-gray-400">Content Clarity</span>
                          </div>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* Testimonials Section */}
        <section className="py-20">
          <div className="max-w-7xl mx-auto px-6">
            <div className="text-center mb-12">
              <p className="text-lg text-gray-600 dark:text-gray-400 mb-2">
                Join over <span className="font-bold text-gray-900 dark:text-white">1,000,000</span> candidates that
                hear back <span className="font-bold text-gray-900 dark:text-white">25%</span> more with JobSpark AI
                than on other platforms 🎉
              </p>
            </div>
            <TestimonialsMarquee />
          </div>
        </section>

        {/* Expert Job Lists Section */}
        <section className="bg-gray-100 dark:bg-gray-800/50 py-20">
          <div className="max-w-7xl mx-auto px-6 text-center">
            <div className="space-y-6">
              <h2 className="text-4xl md:text-5xl font-bold text-gray-900 dark:text-white">
                Explore our{" "}
                <span className="relative">
                  expert-curated
                  <div className="absolute -bottom-2 left-0 right-0 h-1 bg-teal-400 rounded"></div>
                </span>{" "}
                job lists.
              </h2>
              <p className="text-lg text-gray-600 dark:text-gray-400 max-w-3xl mx-auto">
                Our team handpicks the most exciting opportunities into lists for you to discover - updated daily.
              </p>
            </div>
          </div>
        </section>

        {/* CTA Section */}
        <section className="py-20">
          <div className="max-w-4xl mx-auto px-6 text-center">
            <Card className="card-glow p-12">
              <CardContent className="p-0 space-y-6">
                <h2 className="text-3xl font-bold text-gray-900 dark:text-white">
                  Ready to build your perfect resume?
                </h2>
                <p className="text-gray-600 dark:text-gray-400 text-lg">
                  Join millions of job seekers who have already optimized their resumes with our AI-powered platform.
                </p>
                <Button className="bg-teal-500 hover:bg-teal-600 text-white font-medium px-8 py-4 rounded-full text-lg">
                  Start Building Now - It's Free!
                </Button>
              </CardContent>
            </Card>
          </div>
        </section>
      </div>
    </>
  )
}
