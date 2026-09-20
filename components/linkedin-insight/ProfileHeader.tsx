'use client'

import { MapPin, Users, ExternalLink, Download, BookmarkPlus, Loader2 } from 'lucide-react'
import { LinkedInProfile } from '@/lib/linkedin/types'
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'

interface ProfileHeaderProps {
  profile: LinkedInProfile
  onSave: () => void
  onExport: () => void
  saving: boolean
}

export function ProfileHeader({ profile, onSave, onExport, saving }: ProfileHeaderProps) {
  const initials = profile.name?.split(' ').map(n => n[0]).join('').toUpperCase() || '?'

  return (
    <Card className="w-full overflow-hidden bg-gradient-to-r from-indigo-50/50 to-blue-50/50 dark:from-indigo-950/50 dark:to-blue-950/50 border-none shadow-md">
      <CardContent className="p-8">
        <div className="flex flex-col md:flex-row gap-6 items-start md:items-center">
          <Avatar className="w-24 h-24 border-4 border-white dark:border-slate-800 shadow-sm">
            <AvatarImage src={profile.photoUrl || ''} alt={profile.name} />
            <AvatarFallback className="text-2xl font-bold bg-indigo-100 text-indigo-700 dark:bg-indigo-900 dark:text-indigo-300">
              {initials}
            </AvatarFallback>
          </Avatar>

          <div className="flex-1 space-y-2">
            <h1 className="text-3xl font-bold text-slate-900 dark:text-white">{profile.name}</h1>
            <p className="text-lg text-slate-700 dark:text-slate-300">{profile.headline}</p>

            <div className="flex flex-wrap items-center gap-4 text-sm text-slate-500 dark:text-slate-400">
              {profile.location && (
                <div className="flex items-center gap-1">
                  <MapPin className="w-4 h-4" />
                  <span>{profile.location}</span>
                </div>
              )}
              {profile.connectionCount && (
                <div className="flex items-center gap-1">
                  <Users className="w-4 h-4" />
                  <span>{profile.connectionCount} connections</span>
                </div>
              )}
            </div>
          </div>

          <div className="flex flex-col sm:flex-row gap-3 mt-4 md:mt-0 w-full md:w-auto">
            {profile.profileUrl && (
              <Button variant="outline" asChild className="w-full sm:w-auto">
                <a href={profile.profileUrl} target="_blank" rel="noopener noreferrer">
                  <ExternalLink className="w-4 h-4 mr-2" />
                  View on LinkedIn
                </a>
              </Button>
            )}
            <Button variant="secondary" onClick={onExport} className="w-full sm:w-auto">
              <Download className="w-4 h-4 mr-2" />
              Export PDF
            </Button>
            <Button onClick={onSave} disabled={saving} className="w-full sm:w-auto bg-indigo-600 hover:bg-indigo-700">
              {saving ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <BookmarkPlus className="w-4 h-4 mr-2" />}
              {saving ? 'Saving...' : 'Save Profile'}
            </Button>
          </div>
        </div>

        {/* About section */}
        {profile.about && (
          <div className="mt-6 pt-6 border-t border-slate-200 dark:border-slate-700">
            <p className="text-sm text-slate-600 dark:text-slate-400 leading-relaxed line-clamp-4">
              {profile.about}
            </p>
          </div>
        )}
      </CardContent>
    </Card>
  )
}
