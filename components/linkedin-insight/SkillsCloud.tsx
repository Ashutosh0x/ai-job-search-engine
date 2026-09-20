'use client'

import { useState } from 'react'
import { LinkedInSkill } from '@/lib/linkedin/types'
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'
import { Search } from 'lucide-react'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip'

export function SkillsCloud({ skills = [] }: { skills: LinkedInSkill[] }) {
  const [search, setSearch] = useState('')
  
  const filteredSkills = skills.filter(s => s.name.toLowerCase().includes(search.toLowerCase()))

  return (
    <Card className="mb-8">
      <CardHeader className="flex flex-row items-center justify-between pb-2">
        <CardTitle className="flex items-center gap-2">
          Skills
          <Badge variant="secondary">{skills.length}</Badge>
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className="relative mb-6">
          <Search className="absolute left-3 top-2.5 h-4 w-4 text-slate-400" />
          <Input 
            placeholder="Search skills..." 
            className="pl-9"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
        
        <TooltipProvider>
          <div className="flex flex-wrap gap-2">
            {filteredSkills.length > 0 ? filteredSkills.map((skill, i) => (
              <Tooltip key={i}>
                <TooltipTrigger>
                  <Badge 
                    variant="outline" 
                    className={`text-sm py-1.5 px-3 bg-slate-50 hover:bg-slate-100 dark:bg-slate-900 dark:hover:bg-slate-800 transition-colors ${
                      (skill.endorsements || 0) > 10 ? 'border-indigo-300 dark:border-indigo-700' : ''
                    }`}
                  >
                    {skill.name}
                    {skill.endorsements ? (
                      <span className="ml-2 text-xs text-slate-500 font-normal">
                        {skill.endorsements}
                      </span>
                    ) : null}
                  </Badge>
                </TooltipTrigger>
                <TooltipContent>
                  <p>{skill.name} {skill.endorsements ? `(${skill.endorsements} endorsements)` : ''}</p>
                </TooltipContent>
              </Tooltip>
            )) : (
              <p className="text-sm text-slate-500">No skills found.</p>
            )}
          </div>
        </TooltipProvider>
      </CardContent>
    </Card>
  )
}
