'use client'

import { motion } from 'framer-motion'
import { Briefcase, MapPin } from 'lucide-react'
import { LinkedInExperience } from '@/lib/linkedin/types'
import { Badge } from '@/components/ui/badge'
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card'

export function ExperienceTimeline({ experience = [] }: { experience: LinkedInExperience[] }) {
  if (!experience || experience.length === 0) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Briefcase className="w-5 h-5 text-slate-500" />
            Experience
          </CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-muted-foreground text-sm">No experience data available.</p>
        </CardContent>
      </Card>
    )
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Briefcase className="w-5 h-5 text-slate-500" />
          Experience
          <Badge variant="secondary" className="ml-2">{experience.length}</Badge>
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className="relative border-l-2 border-slate-200 dark:border-slate-800 ml-4 space-y-8">
          {experience.map((exp, index) => (
            <motion.div
              key={index}
              initial={{ opacity: 0, x: -20 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ delay: index * 0.08 }}
              className="relative pl-8"
            >
              <div className="absolute -left-[21px] bg-white dark:bg-slate-950 p-1 rounded-full border-2 border-slate-200 dark:border-slate-800">
                {exp.companyLogo ? (
                  <img src={exp.companyLogo} alt={exp.company} className="w-8 h-8 rounded-full object-cover" />
                ) : (
                  <div className="w-8 h-8 rounded-full bg-slate-100 dark:bg-slate-800 flex items-center justify-center">
                    <span className="text-xs font-bold text-slate-500">{exp.company?.charAt(0) || '?'}</span>
                  </div>
                )}
              </div>

              <div className="space-y-1">
                <div className="flex flex-wrap items-center gap-2">
                  <h3 className="font-bold text-slate-900 dark:text-white">{exp.title}</h3>
                  {exp.isCurrent && (
                    <Badge className="bg-emerald-100 text-emerald-800 dark:bg-emerald-900 dark:text-emerald-300 text-[10px]">Current</Badge>
                  )}
                </div>

                <h4 className="text-sm font-medium text-slate-700 dark:text-slate-300">{exp.company}</h4>

                <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-slate-500 dark:text-slate-400">
                  <span>{exp.dateRange}</span>
                  {exp.duration && <span>• {exp.duration}</span>}
                  {exp.location && (
                    <span className="flex items-center gap-1">
                      • <MapPin className="w-3 h-3" /> {exp.location}
                    </span>
                  )}
                </div>

                {exp.description && (
                  <p className="text-sm text-slate-600 dark:text-slate-400 mt-2 whitespace-pre-wrap line-clamp-3 hover:line-clamp-none transition-all cursor-pointer">
                    {exp.description}
                  </p>
                )}
              </div>
            </motion.div>
          ))}
        </div>
      </CardContent>
    </Card>
  )
}
