"use client"
import { useEffect, useMemo, useState } from "react"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Clock, ExternalLink, TrendingUp, Building2 } from "lucide-react"
import Navigation from "@/components/navigation"
import { getSupabaseClientSafe } from "@/lib/supabase"
import { getRelativeTime } from "@/lib/utils"

type Blog = {
  id: number
  title: string
  category: string | null
  description: string | null
  image_url: string | null
  link: string | null
  section: "industry" | "startup"
  created_at: string
}

function getHostname(url: string | null): string | null {
  if (!url) return null
  try {
    const { hostname } = new URL(url)
    return hostname.replace(/^www\./, "")
  } catch {
    return null
  }
}

export default function NewsFeed() {
  const [blogs, setBlogs] = useState<Blog[]>([])
  const [loading, setLoading] = useState<boolean>(true)

  useEffect(() => {
    const supabase = getSupabaseClientSafe()

    async function fetchBlogs() {
      setLoading(true)
      const { data, error } = await supabase
        .from("blogs")
        .select("id,title,category,description,image_url,link,section,created_at")
        .order("created_at", { ascending: false })
        .limit(100)

      if (!error && data) {
        setBlogs(data as Blog[])
      }
      setLoading(false)
    }

    fetchBlogs()

    const channel = supabase
      .channel("blogs-changes")
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "blogs" },
        (payload: any) => {
          const newBlog = payload.new as Blog
          setBlogs((prev) => [newBlog, ...prev])
        }
      )
      .on(
        "postgres_changes",
        { event: "UPDATE", schema: "public", table: "blogs" },
        (payload: any) => {
          const updated = payload.new as Blog
          setBlogs((prev) => prev.map((b) => (b.id === updated.id ? updated : b)))
        }
      )
      .on(
        "postgres_changes",
        { event: "DELETE", schema: "public", table: "blogs" },
        (payload: any) => {
          const removed = payload.old as { id: number }
          setBlogs((prev) => prev.filter((b) => b.id !== removed.id))
        }
      )
      .subscribe()

    return () => {
      supabase.removeChannel(channel)
    }
  }, [])

  const industryNews = useMemo(() => blogs.filter((b) => b.section === "industry"), [blogs])
  const startupNews = useMemo(() => blogs.filter((b) => b.section === "startup"), [blogs])

  return (
    <>
      <Navigation />
      <div className="min-h-screen p-6">
        <div className="max-w-6xl mx-auto space-y-6">
          <div className="text-center space-y-4">
            <h1 className="text-3xl font-bold text-gray-900 dark:text-white">Industry News</h1>
            <p className="text-gray-600 dark:text-gray-400 max-w-2xl mx-auto">
              Stay updated with the latest trends, insights, and developments in the job market and startup ecosystem.
            </p>
          </div>

          <Tabs defaultValue="industry" className="w-full">
            <TabsList className="grid w-full grid-cols-2 bg-gray-800/50 border border-gray-700">
              <TabsTrigger value="industry" className="data-[state=active]:bg-purple-600 data-[state=active]:text-white">
                <TrendingUp className="w-4 h-4 mr-2" />
                Industry News
              </TabsTrigger>
              <TabsTrigger value="startup" className="data-[state=active]:bg-purple-600 data-[state=active]:text-white">
                <Building2 className="w-4 h-4 mr-2" />
                Startup News
              </TabsTrigger>
            </TabsList>

            <TabsContent value="industry" className="space-y-6 mt-6">
              {loading && blogs.length === 0 ? (
                <div className="text-center text-sm text-gray-500">Loading latest industry news…</div>
              ) : (
                <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-6">
                  {industryNews.map((article) => (
                    <Card key={article.id} className="card-glow hover:scale-[1.02] transition-transform">
                      <CardContent className="p-0">
                        <div className="aspect-video bg-gray-700 rounded-t-xl overflow-hidden">
                          <img
                            src={article.image_url || "/placeholder.svg"}
                            alt={article.title}
                            className="w-full h-full object-cover"
                          />
                        </div>
                        <div className="p-6 space-y-4">
                          <div className="flex items-center justify-between">
                            <Badge variant="secondary" className="bg-purple-600/20 text-purple-300 border-purple-600/30">
                              {article.category || "General"}
                            </Badge>
                            <span className="text-xs text-gray-600 dark:text-gray-400 flex items-center">
                              <Clock className="w-3 h-3 mr-1" />
                              {getRelativeTime(article.created_at)}
                            </span>
                          </div>

                          <h3 className="font-semibold text-gray-900 dark:text-white text-lg leading-tight">
                            {article.title}
                          </h3>

                          {article.description && (
                            <p className="text-gray-600 dark:text-gray-400 text-sm line-clamp-3">
                              {article.description}
                            </p>
                          )}

                          <div className="flex items-center justify-between pt-2">
                            <span className="text-xs text-gray-500">{getHostname(article.link) || "Source"}</span>
                            {article.link ? (
                              <Button asChild className="btn-secondary text-sm px-4 py-2">
                                <a href={article.link} target="_blank" rel="noopener noreferrer">
                                  Read More
                                  <ExternalLink className="w-3 h-3 ml-1" />
                                </a>
                              </Button>
                            ) : null}
                          </div>
                        </div>
                      </CardContent>
                    </Card>
                  ))}
                </div>
              )}
              {!loading && industryNews.length === 0 && (
                <div className="text-center text-sm text-gray-500">No industry news yet.</div>
              )}
            </TabsContent>

            <TabsContent value="startup" className="space-y-6 mt-6">
              {loading && blogs.length === 0 ? (
                <div className="text-center text-sm text-gray-500">Loading latest startup news…</div>
              ) : (
                <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-6">
                  {startupNews.map((article) => (
                    <Card key={article.id} className="card-glow hover:scale-[1.02] transition-transform">
                      <CardContent className="p-0">
                        <div className="aspect-video bg-gray-700 rounded-t-xl overflow-hidden">
                          <img
                            src={article.image_url || "/placeholder.svg"}
                            alt={article.title}
                            className="w-full h-full object-cover"
                          />
                        </div>
                        <div className="p-6 space-y-4">
                          <div className="flex items-center justify-between">
                            <Badge variant="secondary" className="bg-green-600/20 text-green-300 border-green-600/30">
                              {article.category || "General"}
                            </Badge>
                            <span className="text-xs text-gray-600 dark:text-gray-400 flex items-center">
                              <Clock className="w-3 h-3 mr-1" />
                              {getRelativeTime(article.created_at)}
                            </span>
                          </div>

                          <h3 className="font-semibold text-gray-900 dark:text-white text-lg leading-tight">
                            {article.title}
                          </h3>

                          {article.description && (
                            <p className="text-gray-600 dark:text-gray-400 text-sm line-clamp-3">
                              {article.description}
                            </p>
                          )}

                          <div className="flex items-center justify-between pt-2">
                            <span className="text-xs text-gray-500">{getHostname(article.link) || "Source"}</span>
                            {article.link ? (
                              <Button asChild className="btn-secondary text-sm px-4 py-2">
                                <a href={article.link} target="_blank" rel="noopener noreferrer">
                                  Read More
                                  <ExternalLink className="w-3 h-3 ml-1" />
                                </a>
                              </Button>
                            ) : null}
                          </div>
                        </div>
                      </CardContent>
                    </Card>
                  ))}
                </div>
              )}
              {!loading && startupNews.length === 0 && (
                <div className="text-center text-sm text-gray-500">No startup news yet.</div>
              )}
            </TabsContent>
          </Tabs>
        </div>
      </div>
    </>
  )
}
