"use client"

import { useEffect, useState } from "react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Calendar, Globe, MapPin, Save, X, Image as ImageIcon } from "lucide-react"
import { getCompanyLogo, isValidWebsiteUrl } from "@/lib/company-logo"

export interface Education {
  id: string
  user_id: string
  school_name: string
  degree?: string
  field_of_study?: string
  education_website?: string
  education_logo_url?: string
  location?: string
  start_date?: string
  end_date?: string
  is_current: boolean
  years_of_education?: number
  description?: string
  created_at: string
  updated_at: string
}

interface EducationFormProps {
  education?: Education | null
  onSave: (data: Omit<Education, 'id' | 'user_id' | 'created_at' | 'updated_at'>) => Promise<void> | void
  onCancel: () => void
}

export default function EducationForm({ education, onSave, onCancel }: EducationFormProps) {
  const [formData, setFormData] = useState({
    school_name: education?.school_name || "",
    degree: education?.degree || "",
    field_of_study: education?.field_of_study || "",
    education_website: education?.education_website || "",
    education_logo_url: education?.education_logo_url || "",
    location: education?.location || "",
    start_date: education?.start_date || "",
    end_date: education?.end_date || "",
    is_current: education?.is_current || false,
    years_of_education: education?.years_of_education || undefined,
    description: education?.description || ""
  })
  const [loading, setLoading] = useState(false)
  const [logoLoading, setLogoLoading] = useState(false)

  const handleInputChange = (field: string, value: string | boolean | number | undefined) => {
    setFormData(prev => ({ ...prev, [field]: value }))
  }

  const handleWebsiteChange = async (website: string) => {
    handleInputChange('education_website', website)
    if (isValidWebsiteUrl(website)) {
      setLogoLoading(true)
      try {
        const logo = await getCompanyLogo(website)
        if (logo) handleInputChange('education_logo_url', logo)
      } finally {
        setLogoLoading(false)
      }
    }
  }

  useEffect(() => {
    if (formData.start_date && (formData.end_date || formData.is_current)) {
      const start = new Date(formData.start_date)
      const end = formData.is_current ? new Date() : new Date(formData.end_date!)
      const years = (end.getTime() - start.getTime()) / (1000 * 60 * 60 * 24 * 365.25)
      handleInputChange('years_of_education', Math.max(0, Math.round(years * 10) / 10))
    }
  }, [formData.start_date, formData.end_date, formData.is_current])

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setLoading(true)
    try {
      await onSave({
        school_name: formData.school_name,
        degree: formData.degree || undefined,
        field_of_study: formData.field_of_study || undefined,
        education_website: formData.education_website || undefined,
        education_logo_url: formData.education_logo_url || undefined,
        location: formData.location || undefined,
        start_date: formData.start_date || undefined,
        end_date: formData.end_date || undefined,
        is_current: formData.is_current,
        years_of_education: formData.years_of_education,
        description: formData.description || undefined
      })
    } finally {
      setLoading(false)
    }
  }

  return (
    <Card className="p-6">
      <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
        <CardTitle className="text-2xl font-bold">
          {education ? 'Edit Education' : 'Add Education'}
        </CardTitle>
        <Button variant="ghost" size="sm" onClick={onCancel}>
          <X className="w-4 h-4" />
        </Button>
      </CardHeader>
      <CardContent>
        <form onSubmit={handleSubmit} className="space-y-4">
          <Input
            placeholder="School / University"
            value={formData.school_name}
            onChange={(e) => handleInputChange('school_name', e.target.value)}
            required
          />
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <Input
              placeholder="Degree (e.g., B.Tech, M.Sc)"
              value={formData.degree}
              onChange={(e) => handleInputChange('degree', e.target.value)}
            />
            <Input
              placeholder="Field of Study (e.g., Computer Science)"
              value={formData.field_of_study}
              onChange={(e) => handleInputChange('field_of_study', e.target.value)}
            />
          </div>
          <div className="flex items-center space-x-2">
            <Input
              placeholder="Education Website (e.g., university.edu)"
              value={formData.education_website}
              onChange={(e) => handleWebsiteChange(e.target.value)}
              type="url"
            />
            {logoLoading ? (
              <div className="w-8 h-8 border-2 border-blue-600 border-t-transparent rounded-full animate-spin flex-shrink-0" />
            ) : formData.education_logo_url ? (
              <img src={formData.education_logo_url} alt="Logo" className="w-8 h-8 rounded flex-shrink-0" />
            ) : (
              <ImageIcon className="w-8 h-8 text-gray-400 flex-shrink-0" />
            )}
          </div>
          <Input
            placeholder="Location (e.g., New Delhi, IN)"
            value={formData.location}
            onChange={(e) => handleInputChange('location', e.target.value)}
          />
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="text-sm font-medium">Start Date</label>
              <Input type="date" value={formData.start_date} onChange={(e) => handleInputChange('start_date', e.target.value)} required />
            </div>
            <div>
              <label className="text-sm font-medium">End Date</label>
              <Input type="date" value={formData.end_date} onChange={(e) => handleInputChange('end_date', e.target.value)} disabled={formData.is_current} />
            </div>
          </div>
          <div className="flex items-center space-x-2">
            <input type="checkbox" id="is_current" checked={formData.is_current} onChange={(e) => handleInputChange('is_current', e.target.checked)} className="h-4 w-4" />
            <label htmlFor="is_current" className="text-sm">Currently studying</label>
          </div>
          {formData.years_of_education !== undefined && (
            <div className="text-sm text-gray-600">Years of Education: <Badge variant="outline">{formData.years_of_education} years</Badge></div>
          )}
          <Textarea rows={4} placeholder="Description (achievements, GPA, etc.)" value={formData.description} onChange={(e) => handleInputChange('description', e.target.value)} />
          <div className="flex justify-end space-x-2">
            <Button type="button" variant="outline" onClick={onCancel}><X className="w-4 h-4 mr-2" />Cancel</Button>
            <Button type="submit" disabled={loading}>{loading ? <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin mr-2" /> : <Save className="w-4 h-4 mr-2" />}Save Education</Button>
          </div>
        </form>
      </CardContent>
    </Card>
  )
}


