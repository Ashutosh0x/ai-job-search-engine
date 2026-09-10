"use client"

import { useState, useEffect } from "react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Switch } from "@/components/ui/switch"
import { 
  Bell, 
  Settings, 
  Plus, 
  Trash2, 
  Mail,
  MapPin,
  DollarSign,
  Briefcase
} from "lucide-react"
import { useToast } from "@/components/toast-provider"

interface JobAlert {
  id: string
  name: string
  keywords: string[]
  locations: string[]
  salaryRange: { min: number; max: number }
  jobTypes: string[]
  frequency: 'daily' | 'weekly' | 'instant'
  isActive: boolean
}

export default function JobAlerts() {
  const [alerts, setAlerts] = useState<JobAlert[]>([])
  const [showForm, setShowForm] = useState(false)
  const [newAlert, setNewAlert] = useState<Partial<JobAlert>>({
    name: '',
    keywords: [],
    locations: [],
    salaryRange: { min: 0, max: 200000 },
    jobTypes: [],
    frequency: 'daily',
    isActive: true
  })
  const { addToast } = useToast()

  useEffect(() => {
    fetchAlerts()
  }, [])

  const fetchAlerts = async () => {
    try {
      const response = await fetch("/api/job-alerts")
      if (!response.ok) throw new Error("Failed to fetch alerts")
      
      const data = await response.json()
      setAlerts(data.alerts)
    } catch (error) {
      addToast({
        title: "Error",
        description: "Failed to load job alerts",
        type: "error"
      })
    }
  }

  const createAlert = async () => {
    try {
      const response = await fetch("/api/job-alerts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(newAlert)
      })
      
      if (!response.ok) throw new Error("Failed to create alert")
      
      addToast({
        title: "Alert Created",
        description: "Job alert has been created successfully",
        type: "success"
      })
      
      setShowForm(false)
      setNewAlert({
        name: '',
        keywords: [],
        locations: [],
        salaryRange: { min: 0, max: 200000 },
        jobTypes: [],
        frequency: 'daily',
        isActive: true
      })
      fetchAlerts()
    } catch (error) {
      addToast({
        title: "Error",
        description: "Failed to create job alert",
        type: "error"
      })
    }
  }

  const toggleAlert = async (alertId: string, isActive: boolean) => {
    try {
      const response = await fetch(`/api/job-alerts/${alertId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ isActive })
      })
      
      if (!response.ok) throw new Error("Failed to update alert")
      
      setAlerts(alerts.map(alert => 
        alert.id === alertId ? { ...alert, isActive } : alert
      ))
    } catch (error) {
      addToast({
        title: "Error",
        description: "Failed to update alert",
        type: "error"
      })
    }
  }

  const deleteAlert = async (alertId: string) => {
    try {
      const response = await fetch(`/api/job-alerts/${alertId}`, {
        method: "DELETE"
      })
      
      if (!response.ok) throw new Error("Failed to delete alert")
      
      addToast({
        title: "Alert Deleted",
        description: "Job alert has been deleted",
        type: "success"
      })
      
      fetchAlerts()
    } catch (error) {
      addToast({
        title: "Error",
        description: "Failed to delete alert",
        type: "error"
      })
    }
  }

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <CardTitle className="flex items-center gap-2">
              <Bell className="w-5 h-5 text-purple-600" />
              Job Alerts
            </CardTitle>
            <Button onClick={() => setShowForm(true)} className="bg-purple-600 hover:bg-purple-700">
              <Plus className="w-4 h-4 mr-2" />
              New Alert
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          {alerts.length === 0 ? (
            <div className="text-center py-8 text-gray-500">
              <Bell className="w-12 h-12 mx-auto mb-4 text-gray-300" />
              <p>No job alerts set up yet.</p>
              <p className="text-sm">Create your first alert to get notified about relevant job opportunities.</p>
            </div>
          ) : (
            <div className="space-y-4">
              {alerts.map((alert) => (
                <div key={alert.id} className="p-4 border rounded-lg">
                  <div className="flex items-center justify-between">
                    <div className="flex-1">
                      <div className="flex items-center gap-2 mb-2">
                        <h3 className="font-semibold">{alert.name}</h3>
                        <Badge variant={alert.isActive ? "default" : "secondary"}>
                          {alert.isActive ? "Active" : "Inactive"}
                        </Badge>
                        <Badge variant="outline">{alert.frequency}</Badge>
                      </div>
                      
                      <div className="flex flex-wrap gap-2 text-sm text-gray-600 dark:text-gray-400">
                        {alert.keywords.length > 0 && (
                          <div className="flex items-center gap-1">
                            <Briefcase className="w-3 h-3" />
                            {alert.keywords.join(", ")}
                          </div>
                        )}
                        {alert.locations.length > 0 && (
                          <div className="flex items-center gap-1">
                            <MapPin className="w-3 h-3" />
                            {alert.locations.join(", ")}
                          </div>
                        )}
                        {alert.salaryRange.max > 0 && (
                          <div className="flex items-center gap-1">
                            <DollarSign className="w-3 h-3" />
                            ${alert.salaryRange.min.toLocaleString()} - ${alert.salaryRange.max.toLocaleString()}
                          </div>
                        )}
                      </div>
                    </div>
                    
                    <div className="flex items-center gap-2">
                      <Switch
                        checked={alert.isActive}
                        onCheckedChange={(checked) => toggleAlert(alert.id, checked)}
                      />
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => deleteAlert(alert.id)}
                      >
                        <Trash2 className="w-4 h-4" />
                      </Button>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {showForm && (
        <Card>
          <CardHeader>
            <CardTitle>Create New Job Alert</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div>
              <label className="block text-sm font-medium mb-1">Alert Name</label>
              <Input
                value={newAlert.name}
                onChange={(e) => setNewAlert({ ...newAlert, name: e.target.value })}
                placeholder="e.g., Senior Developer Positions"
              />
            </div>
            
            <div>
              <label className="block text-sm font-medium mb-1">Keywords</label>
              <Input
                value={newAlert.keywords?.join(", ")}
                onChange={(e) => setNewAlert({ 
                  ...newAlert, 
                  keywords: e.target.value.split(",").map(k => k.trim()).filter(k => k)
                })}
                placeholder="React, TypeScript, Node.js"
              />
            </div>
            
            <div>
              <label className="block text-sm font-medium mb-1">Locations</label>
              <Input
                value={newAlert.locations?.join(", ")}
                onChange={(e) => setNewAlert({ 
                  ...newAlert, 
                  locations: e.target.value.split(",").map(l => l.trim()).filter(l => l)
                })}
                placeholder="San Francisco, Remote, New York"
              />
            </div>
            
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium mb-1">Min Salary</label>
                <Input
                  type="number"
                  value={newAlert.salaryRange?.min}
                  onChange={(e) => setNewAlert({ 
                    ...newAlert, 
                    salaryRange: { ...newAlert.salaryRange!, min: parseInt(e.target.value) }
                  })}
                  placeholder="50000"
                />
              </div>
              <div>
                <label className="block text-sm font-medium mb-1">Max Salary</label>
                <Input
                  type="number"
                  value={newAlert.salaryRange?.max}
                  onChange={(e) => setNewAlert({ 
                    ...newAlert, 
                    salaryRange: { ...newAlert.salaryRange!, max: parseInt(e.target.value) }
                  })}
                  placeholder="150000"
                />
              </div>
            </div>
            
            <div>
              <label className="block text-sm font-medium mb-1">Frequency</label>
              <select
                value={newAlert.frequency}
                onChange={(e) => setNewAlert({ ...newAlert, frequency: e.target.value as any })}
                className="w-full p-2 border rounded-md"
              >
                <option value="instant">Instant</option>
                <option value="daily">Daily</option>
                <option value="weekly">Weekly</option>
              </select>
            </div>
            
            <div className="flex gap-2">
              <Button onClick={createAlert} className="bg-purple-600 hover:bg-purple-700">
                Create Alert
              </Button>
              <Button onClick={() => setShowForm(false)} variant="outline">
                Cancel
              </Button>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  )
}
