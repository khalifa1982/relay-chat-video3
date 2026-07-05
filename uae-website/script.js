// ===== UAE.com - Animated Intro Website =====
// Version 2.0

(function() {
    'use strict';

    // ===== PRELOADER =====
    window.addEventListener('load', () => {
        setTimeout(() => {
            document.getElementById('preloader').classList.add('hidden');
            initAll();
        }, 2000);
    });

    function initAll() {
        initMeshCanvas();
        initUAEMap();
        initHashOverlay();
        initParticleField();
        initScrollObserver();
        initChatDemo();
        initFinalCanvas();
        initAutoScroll();
    }

    // ===== UAE MAP SVG =====
    function initUAEMap() {
        const svg = document.getElementById('uaeMap');
        // Simplified UAE map path
        const uaePath = `M 120 280 L 140 260 L 180 240 L 220 220 L 280 200 L 340 190 
            L 380 185 L 420 180 L 460 178 L 500 180 L 540 185 L 580 195 
            L 620 210 L 650 230 L 670 250 L 680 270 L 685 290 L 680 310 
            L 670 330 L 650 345 L 620 355 L 580 360 L 540 358 L 500 350 
            L 460 345 L 420 340 L 380 338 L 340 340 L 300 345 L 260 350 
            L 220 355 L 180 350 L 150 335 L 130 315 L 120 295 Z`;

        // Main country outline
        const mainPath = document.createElementNS('http://www.w3.org/2000/svg', 'path');
        mainPath.setAttribute('d', uaePath);
        mainPath.setAttribute('fill', 'rgba(15, 20, 35, 0.8)');
        mainPath.setAttribute('stroke', 'rgba(0, 229, 255, 0.4)');
        mainPath.setAttribute('stroke-width', '1.5');
        mainPath.style.filter = 'drop-shadow(0 0 10px rgba(0, 229, 255, 0.2))';
        svg.appendChild(mainPath);

        // Animated stroke
        const animPath = document.createElementNS('http://www.w3.org/2000/svg', 'path');
        animPath.setAttribute('d', uaePath);
        animPath.setAttribute('fill', 'none');
        animPath.setAttribute('stroke', 'rgba(0, 229, 255, 0.8)');
        animPath.setAttribute('stroke-width', '2');
        animPath.setAttribute('stroke-dasharray', '10 20');
        animPath.style.animation = 'dashMove 8s linear infinite';
        svg.appendChild(animPath);

        // Add style for dash animation
        const style = document.createElement('style');
        style.textContent = `
            @keyframes dashMove {
                to { stroke-dashoffset: -200; }
            }
        `;
        document.head.appendChild(style);

        // Emirates dividers
        const dividers = [
            'M 350 190 L 340 340',
            'M 420 180 L 420 340',
            'M 480 178 L 470 345',
            'M 540 185 L 530 358',
            'M 600 200 L 590 358',
            'M 640 220 L 640 350'
        ];

        dividers.forEach(d => {
            const line = document.createElementNS('http://www.w3.org/2000/svg', 'path');
            line.setAttribute('d', d);
            line.setAttribute('fill', 'none');
            line.setAttribute('stroke', 'rgba(0, 229, 255, 0.15)');
            line.setAttribute('stroke-width', '0.5');
            line.setAttribute('stroke-dasharray', '4 6');
            svg.appendChild(line);
        });

        // City nodes
        const cities = [
            { x: 300, y: 280, name: 'Abu Dhabi', size: 6 },
            { x: 550, y: 250, name: 'Dubai', size: 7 },
            { x: 620, y: 240, name: 'Sharjah', size: 5 },
            { x: 660, y: 260, name: 'Ajman', size: 4 },
            { x: 450, y: 270, name: 'Al Ain', size: 4 },
            { x: 670, y: 280, name: 'RAK', size: 4 },
            { x: 640, y: 250, name: 'UAQ', size: 3 }
        ];

        cities.forEach((city, i) => {
            // Pulse ring
            const pulse = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
            pulse.setAttribute('cx', city.x);
            pulse.setAttribute('cy', city.y);
            pulse.setAttribute('r', city.size);
            pulse.setAttribute('fill', 'none');
            pulse.setAttribute('stroke', 'rgba(0, 229, 255, 0.4)');
            pulse.setAttribute('stroke-width', '1');
            pulse.style.animation = `nodePulse 3s ease-in-out infinite ${i * 0.4}s`;
            svg.appendChild(pulse);

            // Core dot
            const dot = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
            dot.setAttribute('cx', city.x);
            dot.setAttribute('cy', city.y);
            dot.setAttribute('r', '3');
            dot.setAttribute('fill', 'rgba(0, 229, 255, 0.9)');
            dot.style.filter = 'drop-shadow(0 0 6px rgba(0, 229, 255, 0.8))';
            svg.appendChild(dot);

            // Label
            const text = document.createElementNS('http://www.w3.org/2000/svg', 'text');
            text.setAttribute('x', city.x);
            text.setAttribute('y', city.y - 12);
            text.setAttribute('text-anchor', 'middle');
            text.setAttribute('fill', 'rgba(255, 255, 255, 0.5)');
            text.setAttribute('font-size', '8');
            text.setAttribute('font-family', 'Inter, sans-serif');
            text.textContent = city.name;
            svg.appendChild(text);
        });

        // Connection lines between cities
        const connections = [
            [0, 1], [1, 2], [2, 3], [0, 4], [1, 4], [2, 5], [3, 5], [2, 6]
        ];

        connections.forEach(([a, b], i) => {
            const line = document.createElementNS('http://www.w3.org/2000/svg', 'line');
            line.setAttribute('x1', cities[a].x);
            line.setAttribute('y1', cities[a].y);
            line.setAttribute('x2', cities[b].x);
            line.setAttribute('y2', cities[b].y);
            line.setAttribute('stroke', 'rgba(0, 229, 255, 0.15)');
            line.setAttribute('stroke-width', '0.8');
            line.setAttribute('stroke-dasharray', '3 5');
            line.style.animation = `lineFlicker 4s ease-in-out infinite ${i * 0.3}s`;
            svg.appendChild(line);
        });

        // Add node pulse animation
        const nodeStyle = document.createElement('style');
        nodeStyle.textContent = `
            @keyframes nodePulse {
                0%, 100% { r: ${3}; opacity: 0.4; }
                50% { r: ${8}; opacity: 0; }
            }
            @keyframes lineFlicker {
                0%, 100% { opacity: 0.15; }
                50% { opacity: 0.5; }
            }
        `;
        document.head.appendChild(nodeStyle);
    }

    // ===== MESH CANVAS (AI Network) =====
    function initMeshCanvas() {
        const canvas = document.getElementById('meshCanvas');
        const ctx = canvas.getContext('2d');
        let width, height, nodes = [], animFrame;

        function resize() {
            width = canvas.width = window.innerWidth;
            height = canvas.height = window.innerHeight;
        }

        resize();
        window.addEventListener('resize', resize);

        // Create nodes
        const nodeCount = Math.min(80, Math.floor(window.innerWidth / 15));
        for (let i = 0; i < nodeCount; i++) {
            nodes.push({
                x: Math.random() * width,
                y: Math.random() * height,
                vx: (Math.random() - 0.5) * 0.5,
                vy: (Math.random() - 0.5) * 0.5,
                radius: Math.random() * 2 + 1,
                pulse: Math.random() * Math.PI * 2
            });
        }

        function animate() {
            ctx.clearRect(0, 0, width, height);

            // Update and draw nodes
            nodes.forEach((node, i) => {
                node.x += node.vx;
                node.y += node.vy;
                node.pulse += 0.02;

                // Bounce off edges
                if (node.x < 0 || node.x > width) node.vx *= -1;
                if (node.y < 0 || node.y > height) node.vy *= -1;

                // Draw connections
                for (let j = i + 1; j < nodes.length; j++) {
                    const dx = nodes[j].x - node.x;
                    const dy = nodes[j].y - node.y;
                    const dist = Math.sqrt(dx * dx + dy * dy);

                    if (dist < 150) {
                        const alpha = (1 - dist / 150) * 0.3;
                        ctx.beginPath();
                        ctx.moveTo(node.x, node.y);
                        ctx.lineTo(nodes[j].x, nodes[j].y);
                        ctx.strokeStyle = `rgba(0, 229, 255, ${alpha})`;
                        ctx.lineWidth = 0.5;
                        ctx.stroke();
                    }
                }

                // Draw node
                const pulseAlpha = 0.4 + Math.sin(node.pulse) * 0.3;
                ctx.beginPath();
                ctx.arc(node.x, node.y, node.radius, 0, Math.PI * 2);
                ctx.fillStyle = `rgba(0, 229, 255, ${pulseAlpha})`;
                ctx.fill();
            });

            // Occasional data burst effect
            if (Math.random() < 0.02) {
                const sourceNode = nodes[Math.floor(Math.random() * nodes.length)];
                const targetNode = nodes[Math.floor(Math.random() * nodes.length)];
                ctx.beginPath();
                ctx.moveTo(sourceNode.x, sourceNode.y);
                ctx.lineTo(targetNode.x, targetNode.y);
                ctx.strokeStyle = 'rgba(0, 229, 255, 0.8)';
                ctx.lineWidth = 2;
                ctx.stroke();
            }

            animFrame = requestAnimationFrame(animate);
        }

        animate();
    }

    // ===== HASH OVERLAY =====
    function initHashOverlay() {
        const overlay = document.getElementById('hashOverlay');
        const chars = '0123456789abcdef';

        function createHash() {
            const line = document.createElement('div');
            line.className = 'hash-line';
            line.style.left = Math.random() * 100 + '%';
            line.style.top = Math.random() * 100 + '%';
            line.style.animationDuration = (3 + Math.random() * 4) + 's';

            let hash = '';
            for (let i = 0; i < 16; i++) {
                hash += chars[Math.floor(Math.random() * chars.length)];
            }
            line.textContent = hash;
            overlay.appendChild(line);

            setTimeout(() => {
                if (line.parentNode) line.parentNode.removeChild(line);
            }, 7000);
        }

        setInterval(createHash, 300);
    }

    // ===== PARTICLE FIELD =====
    function initParticleField() {
        const field = document.getElementById('particleField');
        
        for (let i = 0; i < 40; i++) {
            const particle = document.createElement('div');
            particle.className = 'particle';
            particle.style.left = Math.random() * 100 + '%';
            particle.style.animationDelay = Math.random() * 6 + 's';
            particle.style.animationDuration = (4 + Math.random() * 4) + 's';
            field.appendChild(particle);
        }
    }

    // ===== SCROLL OBSERVER =====
    function initScrollObserver() {
        const observerOptions = {
            threshold: 0.3,
            rootMargin: '0px'
        };

        const observer = new IntersectionObserver((entries) => {
            entries.forEach(entry => {
                if (entry.isIntersecting) {
                    const section = entry.target;

                    if (section.id === 'section-message') {
                        const lines = section.querySelectorAll('.message-line');
                        lines.forEach((line, i) => {
                            setTimeout(() => {
                                line.classList.add('visible');
                            }, i * 300);
                        });
                    }

                    if (section.id === 'section-chat') {
                        const header = section.querySelector('.chat-header');
                        const container = section.querySelector('.chat-container');
                        setTimeout(() => header.classList.add('visible'), 200);
                        setTimeout(() => {
                            container.classList.add('visible');
                            startChatSequence();
                        }, 600);
                    }

                    if (section.id === 'section-final') {
                        const container = section.querySelector('.final-container');
                        setTimeout(() => container.classList.add('visible'), 300);
                    }
                }
            });
        }, observerOptions);

        document.querySelectorAll('.section').forEach(section => {
            observer.observe(section);
        });
    }

    // ===== CHAT DEMO =====
    let chatStarted = false;

    function initChatDemo() {
        // Pre-setup, actual sequence triggered by scroll
    }

    function startChatSequence() {
        if (chatStarted) return;
        chatStarted = true;

        const inputText = document.getElementById('chatInputText');
        const messages = document.getElementById('chatMessages');
        const searchAnim = document.getElementById('searchAnimation');

        const query = "What are the predicted outcomes for the UEFA Champions League final based on current team form, historical data, and player fitness reports?";
        
        const response = `Based on comprehensive analysis of 847 data points:

<strong>Match Prediction:</strong> 62.3% probability of Team A victory
<strong>Key Factors:</strong>
• Team A: 89% win rate in last 15 matches, 2.4 avg goals/game
• Player fitness index: 94.2% (above tournament average)
• Historical H2H advantage: 7-3 in last 10 meetings

<strong>Risk Variables:</strong> Midfielder injury (12% impact), weather conditions (3% variance)

<strong>Confidence Level:</strong> High (σ = 0.04)`;

        // Phase 1: Type the query
        let charIndex = 0;
        const typeInterval = setInterval(() => {
            if (charIndex < query.length) {
                inputText.textContent += query[charIndex];
                charIndex++;
            } else {
                clearInterval(typeInterval);
                // Phase 2: Submit message
                setTimeout(() => {
                    inputText.textContent = '';
                    addChatBubble('user', query, messages);
                    
                    // Phase 3: Show search animation
                    setTimeout(() => {
                        searchAnim.classList.add('active');
                        
                        // Phase 4: Show response
                        setTimeout(() => {
                            searchAnim.classList.remove('active');
                            addChatBubble('ai', response, messages);
                        }, 2500);
                    }, 500);
                }, 500);
            }
        }, 30);
    }

    function addChatBubble(type, content, container) {
        const bubble = document.createElement('div');
        bubble.className = `chat-bubble ${type}`;
        
        const label = document.createElement('div');
        label.className = 'bubble-label';
        label.textContent = type === 'user' ? 'YOU' : 'UAE.AI';
        
        const contentDiv = document.createElement('div');
        contentDiv.className = 'bubble-content';
        contentDiv.innerHTML = content;
        
        bubble.appendChild(label);
        bubble.appendChild(contentDiv);
        container.appendChild(bubble);
        
        // Scroll to bottom
        container.scrollTop = container.scrollHeight;
    }

    // ===== FINAL CANVAS (Ambient particles) =====
    function initFinalCanvas() {
        const canvas = document.getElementById('finalCanvas');
        const ctx = canvas.getContext('2d');
        let width, height, particles = [];

        function resize() {
            width = canvas.width = window.innerWidth;
            height = canvas.height = window.innerHeight;
        }

        resize();
        window.addEventListener('resize', resize);

        for (let i = 0; i < 50; i++) {
            particles.push({
                x: Math.random() * width,
                y: Math.random() * height,
                vx: (Math.random() - 0.5) * 0.3,
                vy: (Math.random() - 0.5) * 0.3,
                size: Math.random() * 2 + 0.5,
                alpha: Math.random() * 0.5,
                pulse: Math.random() * Math.PI * 2
            });
        }

        function animate() {
            ctx.clearRect(0, 0, width, height);

            particles.forEach(p => {
                p.x += p.vx;
                p.y += p.vy;
                p.pulse += 0.01;

                if (p.x < 0) p.x = width;
                if (p.x > width) p.x = 0;
                if (p.y < 0) p.y = height;
                if (p.y > height) p.y = 0;

                const alpha = p.alpha * (0.5 + Math.sin(p.pulse) * 0.5);
                ctx.beginPath();
                ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
                ctx.fillStyle = `rgba(0, 229, 255, ${alpha})`;
                ctx.fill();
            });

            requestAnimationFrame(animate);
        }

        animate();
    }

    // ===== AUTO SCROLL (Timer-based) =====
    function initAutoScroll() {
        let autoScrollTimer;
        let userInteracted = false;

        // Detect user interaction
        const interactionEvents = ['scroll', 'touchstart', 'wheel', 'mousedown'];
        interactionEvents.forEach(event => {
            window.addEventListener(event, () => {
                userInteracted = true;
                if (autoScrollTimer) clearTimeout(autoScrollTimer);
            }, { once: true });
        });

        // Auto-scroll after 6 seconds if no interaction
        autoScrollTimer = setTimeout(() => {
            if (!userInteracted) {
                smoothScrollTo(document.getElementById('section-message'));
            }
        }, 6000);
    }

    function smoothScrollTo(element) {
        element.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }

})();
