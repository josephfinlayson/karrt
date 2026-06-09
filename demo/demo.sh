#!/bin/bash
# Demo script for karrt — simulates an AI agent shopping for carbonara ingredients
# Pre-captured outputs for reliability; all data from real REWE API responses

BOLD="\033[1m"
DIM="\033[2m"
GREEN="\033[32m"
CYAN="\033[36m"
YELLOW="\033[33m"
MAGENTA="\033[35m"
RESET="\033[0m"
CHECK="\033[32m✓\033[0m"

slow_print() {
  echo -e "$1"
}

pause() {
  sleep "${1:-0.6}"
}

# Header
echo ""
slow_print "${BOLD}${MAGENTA}🛒 karrt${RESET} ${DIM}— AI-powered grocery shopping on REWE${RESET}"
echo ""
pause 1

# User request
slow_print "${DIM}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${RESET}"
slow_print "${BOLD}📱 Telegram:${RESET} Get me ingredients for carbonara, keep it cheap"
slow_print "${DIM}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${RESET}"
echo ""
pause 1.5

# Agent thinking
slow_print "${DIM}Agent: Breaking down carbonara → spaghetti, speck, parmesan, eggs${RESET}"
echo ""
pause 1

# Search 1: Spaghetti
slow_print "${CYAN}\$ karrt search \"Spaghetti\" --sort PRICE_ASC --category nudeln${RESET}"
pause 0.8
slow_print "  ${BOLD}ja! Spaghetti 500g${RESET}                          ${GREEN}0.69€${RESET}  ${DIM}(1kg = 1.38€)${RESET}"
slow_print "  Delverde Spaghetti 500g                        ${DIM}0.69€${RESET}"
slow_print "  REWE Beste Wahl Spaghetti 500g                 ${DIM}0.79€${RESET}"
pause 0.3
slow_print "  ${CHECK} Adding ${BOLD}ja! Spaghetti 500g${RESET} → basket"
echo ""
pause 0.8

# Search 2: Speck/Bacon
slow_print "${CYAN}\$ karrt search \"Speck\" --sort PRICE_ASC --category roher-schinken-speck${RESET}"
pause 0.8
slow_print "  ${BOLD}Butcher's Burger Round Bacon 80g${RESET}              ${GREEN}1.29€${RESET}  ${DIM}(1kg = 16.13€)${RESET}"
slow_print "  Wilhelm Brandenburg Schinkenspeck              ${DIM}1.49€${RESET}"
slow_print "  ja! Delikatess-Lachsschinken 100g              ${DIM}1.59€${RESET}"
pause 0.3
slow_print "  ${CHECK} Adding ${BOLD}Butcher's Bacon Bauchspeck 80g${RESET} → basket"
echo ""
pause 0.8

# Search 3: Parmesan
slow_print "${CYAN}\$ karrt search \"Parmesan\" --sort PRICE_ASC --category hartkaese${RESET}"
pause 0.8
slow_print "  ${BOLD}Ferrari Parmigiano Reggiano 60g${RESET}               ${GREEN}1.79€${RESET}  ${DIM}(1kg = 29.83€)${RESET}"
slow_print "  Giovanni Ferrari Grana Padano 60g              ${DIM}1.79€${RESET}"
slow_print "  Marca Italia Pecorino Romano 60g               ${DIM}1.79€${RESET}"
pause 0.3
slow_print "  ${CHECK} Adding ${BOLD}Ferrari Parmigiano Reggiano 60g${RESET} → basket"
echo ""
pause 0.8

# Search 4: Eggs
slow_print "${CYAN}\$ karrt search \"Eier\" --sort PRICE_ASC --category eier-ei-ersatz${RESET}"
pause 0.8
slow_print "  ${DIM}REWE Bio + vegan Eiersatz 15g             0.69€  ← skipping (not eggs)${RESET}"
slow_print "  ${BOLD}REWE Beste Wahl Eier Bodenhaltung 6 St.${RESET}       ${GREEN}1.89€${RESET}  ${DIM}(1 St. = 0.32€)${RESET}"
slow_print "  REWE Beste Wahl Eier Freilandhaltung 6 St.     ${DIM}2.29€${RESET}"
pause 0.3
slow_print "  ${CHECK} Adding ${BOLD}REWE Eier Bodenhaltung 6 Stück${RESET} → basket"
echo ""
pause 1

# Basket summary
slow_print "${DIM}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${RESET}"
slow_print "${BOLD}📦 Basket${RESET}"
slow_print "${DIM}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${RESET}"
slow_print "  ja! Spaghetti 500g                       ×1        ${GREEN}0.69€${RESET}"
slow_print "  Butcher's Bacon Bauchspeck 80g           ×1        ${GREEN}1.29€${RESET}"
slow_print "  Ferrari Parmigiano Reggiano 60g          ×1        ${GREEN}1.79€${RESET}"
slow_print "  REWE Eier Bodenhaltung 6 Stück           ×1        ${GREEN}1.89€${RESET}"
slow_print "${DIM}─────────────────────────────────────────────────────────────────────────${RESET}"
slow_print "  ${BOLD}Total                                                  ${YELLOW}5.66€${RESET}"
echo ""
pause 0.8

slow_print "${DIM}📱 Reply: Got your carbonara ingredients! 4 items, total 5.66€."
slow_print "   All budget picks. Ready for delivery — want me to reserve a timeslot?${RESET}"
echo ""
pause 4
