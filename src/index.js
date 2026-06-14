const express = require('express')
const app = express()
const port = 3000

app.get('/', (req, res) => {
  res.json({ status: 'ok', service: 'trivy-lab' })
})

app.get('/health', (req, res) => {
  res.json({ healthy: true })
})

app.listen(port, () => {
  console.log(`Server running on port ${port}`)
})