async function initExportPage(): Promise<void> {
  const csvArea = document.getElementById("csv") as HTMLTextAreaElement | null;
  const meta = document.getElementById("meta") as HTMLSpanElement | null;
  const btn = document.getElementById("download") as HTMLButtonElement | null;

  const data = await chrome.storage.local.get(["lastCsv", "lastCsvUpdatedAt", "records"]);
  const csv = (data.lastCsv as string) || "";
  const ts = data.lastCsvUpdatedAt ? new Date(data.lastCsvUpdatedAt as number).toLocaleString() : "-";
  const records = data.records || {};
  
  if (csvArea) csvArea.value = csv;
  if (meta) meta.textContent = `updated: ${ts}`;
  if (btn) {
    btn.addEventListener("click", () => {
      const blob = new Blob([csv], { type: "text/csv" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `bookmark_meta_${Date.now()}.csv`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    });
  }
  
  // Initialize analytics and visuals
  initTabs();
  updateAnalytics(records);
  updateVisuals(records);
}

function initTabs(): void {
  const tabs = document.querySelectorAll('.tab');
  const contents = document.querySelectorAll('.tab-content');
  
  tabs.forEach(tab => {
    tab.addEventListener('click', () => {
      const targetTab = tab.getAttribute('data-tab');
      
      // Update active states
      tabs.forEach(t => t.classList.remove('active'));
      contents.forEach(c => c.classList.remove('active'));
      
      tab.classList.add('active');
      document.getElementById(`${targetTab}-tab`)?.classList.add('active');
    });
  });
}

function updateAnalytics(records: any): void {
  if (!records || typeof records !== 'object') {
    records = {};
  }
  
  const totalLinks = Object.keys(records).length;
  const validLinks = Object.values(records).filter((r: any) => r && r.ok).length;
  const errorLinks = totalLinks - validLinks;
  
  // Count unique tags
  const allTags = new Set<string>();
  Object.values(records).forEach((r: any) => {
    if (r && r.tags && Array.isArray(r.tags)) {
      r.tags.forEach((tag: string) => {
        if (tag && typeof tag === 'string') {
          allTags.add(tag);
        }
      });
    }
  });
  
  // Update stats
  const totalEl = document.getElementById('total-links');
  const validEl = document.getElementById('valid-links');
  const errorEl = document.getElementById('error-links');
  const tagsEl = document.getElementById('unique-tags');
  
  if (totalEl) totalEl.textContent = totalLinks.toString();
  if (validEl) validEl.textContent = validLinks.toString();
  if (errorEl) errorEl.textContent = errorLinks.toString();
  if (tagsEl) tagsEl.textContent = allTags.size.toString();
  
  // Build tag cloud
  const tagFreq = new Map<string, number>();
  Object.values(records).forEach((r: any) => {
    if (r && r.tags && Array.isArray(r.tags)) {
      r.tags.forEach((tag: string) => {
        if (tag && typeof tag === 'string') {
          tagFreq.set(tag, (tagFreq.get(tag) || 0) + 1);
        }
      });
    }
  });
  
  const sortedTags = Array.from(tagFreq.entries()).sort((a, b) => b[1] - a[1]).slice(0, 20);
  const tagCloud = document.getElementById('tag-cloud');
  if (tagCloud) {
    tagCloud.innerHTML = '';
    
    if (sortedTags.length === 0) {
      tagCloud.innerHTML = '<div style="color: #a9abcf; text-align: center; padding: 20px;">No tags found</div>';
    } else {
      sortedTags.forEach(([tag, count]) => {
        const tagEl = document.createElement('div');
        tagEl.className = 'tag';
        tagEl.style.fontSize = `${Math.max(10, Math.min(16, 10 + count * 2))}px`;
        tagEl.textContent = `${tag} (${count})`;
        tagCloud.appendChild(tagEl);
      });
    }
  }
  
  // Build categories list
  const catFreq = new Map<string, number>();
  Object.values(records).forEach((r: any) => {
    if (r && r.category && typeof r.category === 'string') {
      catFreq.set(r.category, (catFreq.get(r.category) || 0) + 1);
    }
  });
  
  const sortedCats = Array.from(catFreq.entries()).sort((a, b) => b[1] - a[1]);
  const maxCount = sortedCats.length > 0 ? Math.max(...sortedCats.map(([, count]) => count)) : 0;
  
  const categoriesList = document.getElementById('categories-list');
  if (categoriesList) {
    categoriesList.innerHTML = '';
    
    if (sortedCats.length === 0) {
      categoriesList.innerHTML = '<div style="color: #a9abcf; text-align: center; padding: 20px;">No categories found</div>';
    } else {
      sortedCats.forEach(([cat, count]) => {
        const item = document.createElement('div');
        item.className = 'category-item';
        item.innerHTML = `
          <span class="category-name">${cat}</span>
          <span class="category-count">${count}</span>
          <div class="progress-bar">
            <div class="progress-fill" style="width: ${(count / maxCount) * 100}%"></div>
          </div>
        `;
        categoriesList.appendChild(item);
      });
    }
  }
}

function updateVisuals(records: any): void {
  if (!records || typeof records !== 'object') {
    records = {};
  }
  
  // Categories pie chart
  const catFreq = new Map<string, number>();
  Object.values(records).forEach((r: any) => {
    if (r && r.category && typeof r.category === 'string') {
      catFreq.set(r.category, (catFreq.get(r.category) || 0) + 1);
    }
  });
  
  const pieCanvas = document.getElementById('pie-chart') as HTMLCanvasElement;
  if (pieCanvas && catFreq.size > 0) {
    pieCanvas.width = pieCanvas.offsetWidth;
    pieCanvas.height = pieCanvas.offsetHeight;
    const pieCtx = pieCanvas.getContext('2d');
    if (pieCtx) {
      drawPieChart(pieCtx, Array.from(catFreq.entries()));
    }
  } else if (pieCanvas) {
    // Show "no data" message
    const ctx = pieCanvas.getContext('2d');
    if (ctx) {
      ctx.clearRect(0, 0, pieCanvas.width, pieCanvas.height);
      ctx.fillStyle = '#a9abcf';
      ctx.font = '16px ui-sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText('No category data', pieCanvas.width / 2, pieCanvas.height / 2);
    }
  }
  
  // Tag frequency chart
  const tagFreq = new Map<string, number>();
  Object.values(records).forEach((r: any) => {
    if (r && r.tags && Array.isArray(r.tags)) {
      r.tags.forEach((tag: string) => {
        if (tag && typeof tag === 'string') {
          tagFreq.set(tag, (tagFreq.get(tag) || 0) + 1);
        }
      });
    }
  });
  
  const tagCanvas = document.getElementById('tag-chart') as HTMLCanvasElement;
  if (tagCanvas && tagFreq.size > 0) {
    tagCanvas.width = tagCanvas.offsetWidth;
    tagCanvas.height = tagCanvas.offsetHeight;
    const tagCtx = tagCanvas.getContext('2d');
    if (tagCtx) {
      drawBarChart(tagCtx, Array.from(tagFreq.entries()).sort((a, b) => b[1] - a[1]).slice(0, 15));
    }
  } else if (tagCanvas) {
    // Show "no data" message
    const ctx = tagCanvas.getContext('2d');
    if (ctx) {
      ctx.clearRect(0, 0, tagCanvas.width, tagCanvas.height);
      ctx.fillStyle = '#a9abcf';
      ctx.font = '16px ui-sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText('No tag data', tagCanvas.width / 2, tagCanvas.height / 2);
    }
  }
}

function drawPieChart(ctx: CanvasRenderingContext2D, data: [string, number][]): void {
  const canvas = ctx.canvas;
  if (canvas.width === 0 || canvas.height === 0) return;
  
  const centerX = canvas.width / 2;
  const centerY = canvas.height / 2;
  const radius = Math.min(centerX, centerY) * 0.7;
  
  if (radius <= 0) return;
  
  const total = data.reduce((sum, [, count]) => sum + count, 0);
  if (total === 0) return;
  
  let currentAngle = 0;
  
  const colors = ['#ff2bd6', '#00e1ff', '#ff8a00', '#8cffbd', '#ff6b9d', '#4ecdc4', '#45b7d1', '#96ceb4'];
  
  data.forEach(([label, count], i) => {
    const sliceAngle = (count / total) * 2 * Math.PI;
    
    ctx.beginPath();
    ctx.moveTo(centerX, centerY);
    ctx.arc(centerX, centerY, radius, currentAngle, currentAngle + sliceAngle);
    ctx.closePath();
    
    ctx.fillStyle = colors[i % colors.length];
    ctx.fill();
    
    // Add label
    const labelAngle = currentAngle + sliceAngle / 2;
    const labelX = centerX + Math.cos(labelAngle) * (radius * 0.6);
    const labelY = centerY + Math.sin(labelAngle) * (radius * 0.6);
    
    ctx.fillStyle = '#e6e7ff';
    ctx.font = '12px ui-sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(`${label} (${count})`, labelX, labelY);
    
    currentAngle += sliceAngle;
  });
}

function drawBarChart(ctx: CanvasRenderingContext2D, data: [string, number][]): void {
  const canvas = ctx.canvas;
  if (canvas.width === 0 || canvas.height === 0) return;
  
  const padding = 40;
  if (canvas.width <= padding * 2 || canvas.height <= padding * 2) return;
  
  const barWidth = (canvas.width - padding * 2) / Math.max(1, data.length);
  const maxValue = Math.max(...data.map(([, count]) => count));
  
  if (maxValue === 0) return;
  
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  
  data.forEach(([label, count], i) => {
    const x = padding + i * barWidth;
    const height = ((count / maxValue) * (canvas.height - padding * 2));
    const y = canvas.height - padding - height;
    
    // Bar
    const gradient = ctx.createLinearGradient(x, y, x, y + height);
    gradient.addColorStop(0, '#ff2bd6');
    gradient.addColorStop(1, '#00e1ff');
    
    ctx.fillStyle = gradient;
    ctx.fillRect(x, y, barWidth * 0.8, height);
    
    // Label
    ctx.fillStyle = '#e6e7ff';
    ctx.font = '10px ui-sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    ctx.fillText(label.slice(0, 8), x + barWidth * 0.4, y + height + 5);
    ctx.fillText(count.toString(), x + barWidth * 0.4, y + height + 20);
  });
}

document.addEventListener("DOMContentLoaded", () => {
  initExportPage().catch(console.error);
});


