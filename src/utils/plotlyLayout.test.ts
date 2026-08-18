import { describe, expect, it } from 'vitest'
import { applyPlotlyUserStyle, mergePlotlyLayout } from './plotlyLayout'

describe('mergePlotlyLayout', () => {
  it('deep merges nested axis, title, legend, and font properties', () => {
    const merged = mergePlotlyLayout(
      {
        xaxis: { title: { text: 'Date', font: { size: 12, color: 'red' } }, gridcolor: 'gray' },
        legend: { orientation: 'h', font: { color: 'white' } },
      },
      {
        xaxis: { title: { font: { size: 18 } }, showgrid: false },
        legend: { font: { size: 14 } },
      },
    )

    expect(merged).toEqual({
      xaxis: { title: { text: 'Date', font: { size: 18, color: 'red' } }, gridcolor: 'gray', showgrid: false },
      legend: { orientation: 'h', font: { color: 'white', size: 14 } },
    })
  })
})

describe('applyPlotlyUserStyle', () => {
  it('applies palette colors and a field-level trace override', () => {
    const styled = applyPlotlyUserStyle(
      {
        data: [
          { type: 'scatter', name: 'Revenue', marker: { size: 4 } },
          { type: 'bar', name: 'Cost - East' },
        ],
        layout: { xaxis: { title: { text: 'Month' } } },
      },
      {
        colorway: ['#111111', '#222222'],
        metricstudio_trace_colors: { Cost: '#abcdef' },
        xaxis: { showgrid: false },
      },
    )

    expect(styled.data[0]).toMatchObject({ marker: { size: 4, color: '#111111' }, line: { color: '#111111' } })
    expect(styled.data[1]).toMatchObject({ marker: { color: '#abcdef' } })
    expect(styled.layout).toEqual({ xaxis: { title: { text: 'Month' }, showgrid: false }, colorway: ['#111111', '#222222'] })
    expect(styled.layout).not.toHaveProperty('metricstudio_trace_colors')
  })

  it('uses the selected palette for pie slices without replacing continuous marker colors', () => {
    const styled = applyPlotlyUserStyle(
      {
        data: [
          { type: 'pie', labels: ['A', 'B', 'C'], marker: { colors: ['old'] } },
          { type: 'scatter', name: 'Density', marker: { color: [1, 2, 3], colorscale: 'Viridis' } },
        ],
        layout: {},
      },
      { colorway: ['#111111', '#222222'] },
    )

    expect(styled.data[0]).toMatchObject({ marker: { colors: ['#111111', '#222222', '#111111'] } })
    expect(styled.data[1]).toMatchObject({ marker: { color: [1, 2, 3], colorscale: 'Viridis' } })
  })
})
