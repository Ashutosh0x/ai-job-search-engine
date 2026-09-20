'use client'

import { GraduationCap } from 'lucide-react'
import { LinkedInEducation } from '@/lib/linkedin/types'
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'

export function EducationSection({ education = [] }: { education: LinkedInEducation[] }) {
  if (!education || education.length === 0) return null

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <GraduationCap className="w-5 h-5 text-slate-500" />
          Education
          <Badge variant="secondary" className="ml-2">{education.length}</Badge>
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className="space-y-6">
          {education.map((edu, idx) => (
            <div key={idx} className="flex gap-4">
              <div className="w-12 h-12 bg-slate-50 dark:bg-slate-900 rounded-lg border border-slate-100 dark:border-slate-800 flex items-center justify-center shrink-0">
                {edu.logo ? (
                  <img src={edu.logo} alt={edu.school} className="w-8 h-8 rounded object-cover" />
                ) : (
                  <GraduationCap className="w-6 h-6 text-slate-400" />
                )}
              </div>
              <div>
                <h4 className="font-semibold text-slate-900 dark:text-slate-100">{edu.school}</h4>
                {(edu.degree || edu.fieldOfStudy) && (
                  <p className="text-sm font-medium text-slate-700 dark:text-slate-300">
                    {edu.degree}{edu.fieldOfStudy ? `, ${edu.fieldOfStudy}` : ''}
                  </p>
                )}
                {edu.dateRange && (
                  <p className="text-sm text-slate-500 mt-1">{edu.dateRange}</p>
                )}
                {edu.description && (
                  <p className="text-sm text-slate-600 dark:text-slate-400 mt-2">{edu.description}</p>
                )}
              </div>
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  )
}
