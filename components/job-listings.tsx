"use client"

import { useState } from "react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Card, CardContent } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import {
  Search,
  Filter,
  Grid3X3,
  List,
  MapPin,
  Clock,
  DollarSign,
  Building2,
  Bookmark,
  ExternalLink,
} from "lucide-react"
import Navigation from "@/components/navigation"

export default function JobListings() {
  const [viewMode, setViewMode] = useState<"grid" | "list">("grid")
  const [searchQuery, setSearchQuery] = useState("")

  const jobs = [
    {
      id: 1,
      title: "Senior Frontend Developer",
      company: "TechCorp",
      location: "San Francisco, CA",
      salary: "$120k - $160k",
      type: "Full-time",
      remote: true,
      tags: ["React", "TypeScript", "Next.js"],
      posted: "2 hours ago",
      description: "We are looking for a Senior Frontend Developer to join our growing team...",
      logo: "🚀",
    },
    {
      id: 2,
      title: "Full Stack Engineer",
      company: "StartupXYZ",
      location: "Remote",
      salary: "$100k - $140k",
      type: "Full-time",
      remote: true,
      tags: ["Node.js", "React", "AWS"],
      posted: "5 hours ago",
      description: "Join our innovative startup as a Full Stack Engineer...",
      logo: "⚡",
    },
    {
      id: 3,
      title: "UI/UX Developer",
      company: "DesignStudio",
      location: "New York, NY",
      salary: "$90k - $120k",
      type: "Contract",
      remote: false,
      tags: ["Figma", "React", "CSS"],
      posted: "1 day ago",
      description: "We need a creative UI/UX Developer to help us build amazing user experiences...",
      logo: "🎨",
    },
    {
      id: 4,
      title: "Backend Developer",
      company: "DataFlow Inc",
      location: "Austin, TX",
      salary: "$110k - $150k",
      type: "Full-time",
      remote: true,
      tags: ["Python", "Django", "PostgreSQL"],
      posted: "2 days ago",
      description: "Looking for a Backend Developer to work on our data processing platform...",
      logo: "📊",
    },
  ]

  return (
    <>
      <Navigation />
      <div className="min-h-screen p-6">
        <div className="max-w-7xl mx-auto space-y-6">
          {/* Header */}
          <div className="flex items-center justify-between">
            <div>
              <h1 className="text-3xl font-bold text-gray-900 dark:text-white">Job Listings</h1>
              <p className="text-gray-600 dark:text-gray-400 mt-1">{jobs.length} jobs found</p>
            </div>
            <div className="flex items-center space-x-2">
              <Button
                variant={viewMode === "grid" ? "default" : "ghost"}
                size="sm"
                onClick={() => setViewMode("grid")}
                className={viewMode === "grid" ? "btn-primary" : "text-gray-600 dark:text-gray-400"}
              >
                <Grid3X3 className="w-4 h-4" />
              </Button>
              <Button
                variant={viewMode === "list" ? "default" : "ghost"}
                size="sm"
                onClick={() => setViewMode("list")}
                className={viewMode === "list" ? "btn-primary" : "text-gray-600 dark:text-gray-400"}
              >
                <List className="w-4 h-4" />
              </Button>
            </div>
          </div>

          {/* Search and Filters */}
          <Card className="card-glow">
            <CardContent className="p-6">
              <div className="flex flex-col md:flex-row gap-4">
                <div className="flex-1 relative">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-gray-600 dark:text-gray-400" />
                  <Input
                    placeholder="Search jobs, companies, or skills..."
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    className="pl-10 bg-gray-800/50 border-gray-700 text-gray-900 dark:text-white placeholder-gray-600 dark:placeholder-gray-400"
                  />
                </div>
                <Button className="btn-secondary">
                  <Filter className="w-4 h-4 mr-2" />
                  Filters
                </Button>
              </div>

              <div className="flex flex-wrap gap-2 mt-4">
                <Badge variant="secondary" className="bg-purple-600/20 text-purple-300 border-purple-600/30">
                  Remote
                </Badge>
                <Badge variant="secondary" className="bg-gray-700 text-gray-300">
                  Full-time
                </Badge>
                <Badge variant="secondary" className="bg-gray-700 text-gray-300">
                  $100k+
                </Badge>
                <Badge variant="secondary" className="bg-gray-700 text-gray-300">
                  Tech
                </Badge>
              </div>
            </CardContent>
          </Card>

          {/* Job Listings */}
          <div className={viewMode === "grid" ? "grid md:grid-cols-2 gap-6" : "space-y-4"}>
            {jobs.map((job) => (
              <Card key={job.id} className="card-glow hover:scale-[1.02] transition-transform">
                <CardContent className="p-6">
                  <div className="flex items-start justify-between mb-4">
                    <div className="flex items-start space-x-3">
                      <div className="w-12 h-12 bg-gray-700 rounded-lg flex items-center justify-center text-2xl">
                        {job.logo}
                      </div>
                      <div>
                        <h3 className="font-semibold text-gray-900 dark:text-white text-lg">{job.title}</h3>
                        <p className="text-gray-600 dark:text-gray-400 flex items-center">
                          <Building2 className="w-4 h-4 mr-1" />
                          {job.company}
                        </p>
                      </div>
                    </div>
                    <Button variant="ghost" size="sm" className="text-gray-600 dark:text-gray-400 hover:text-white">
                      <Bookmark className="w-4 h-4" />
                    </Button>
                  </div>

                  <div className="flex flex-wrap gap-2 mb-4">
                    {job.tags.map((tag) => (
                      <Badge key={tag} variant="secondary" className="bg-gray-700 text-gray-300">
                        {tag}
                      </Badge>
                    ))}
                    {job.remote && <Badge className="bg-green-600/20 text-green-300 border-green-600/30">Remote</Badge>}
                  </div>

                  <p className="text-gray-600 dark:text-gray-400 text-sm mb-4 line-clamp-2">{job.description}</p>

                  <div className="flex items-center justify-between text-sm text-gray-600 dark:text-gray-400 mb-4">
                    <span className="flex items-center">
                      <MapPin className="w-4 h-4 mr-1" />
                      {job.location}
                    </span>
                    <span className="flex items-center">
                      <DollarSign className="w-4 h-4 mr-1" />
                      {job.salary}
                    </span>
                    <span className="flex items-center">
                      <Clock className="w-4 h-4 mr-1" />
                      {job.posted}
                    </span>
                  </div>

                  <div className="flex space-x-3">
                    <Button className="btn-primary flex-1">Apply Now</Button>
                    <Button className="btn-secondary">
                      <ExternalLink className="w-4 h-4" />
                    </Button>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        </div>
      </div>
    </>
  )
}
