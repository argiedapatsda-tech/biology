"""Make lock.seb: the Safe Exam Browser settings file that locks a student's iPad into the test.

    python _seb/make_seb.py <quit password>

Writes lock.seb next to index.html. Students open it with the link
sebs://argiedapatsda-tech.github.io/biology/lock.seb (QR on the teacher's join screen).
Format (safeexambrowser.org/developer/seb-file-format.html): gzip( b'plnd' + gzip(XML plist) ).
A quit password is what switches SEB into its secure mode, which starts Apple's
Assessment Mode (AAC): no Home, no app switcher, no other apps until the password is typed.
"""
import gzip, hashlib, os, sys

SITE = 'https://argiedapatsda-tech.github.io/biology/'

def plist(settings):
    out = ['<?xml version="1.0" encoding="UTF-8"?>',
           '<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">',
           '<plist version="1.0">', '<dict>']
    for k in sorted(settings):
        v = settings[k]
        out.append(f'\t<key>{k}</key>')
        if isinstance(v, bool): out.append('\t<true/>' if v else '\t<false/>')
        elif isinstance(v, int): out.append(f'\t<integer>{v}</integer>')
        else: out.append(f'\t<string>{v}</string>')
    out += ['</dict>', '</plist>', '']
    return '\n'.join(out).encode('utf-8')

def main():
    if len(sys.argv) < 2: sys.exit('usage: make_seb.py <quit password>')
    pw = sys.argv[1]
    settings = {
        'sebConfigPurpose': 0,                     # 0 = starting an exam (not reconfiguring the app)
        'startURL': SITE + 'student.html',
        'hashedQuitPassword': hashlib.sha256(pw.encode('utf-8')).hexdigest().upper(),
        'allowQuit': True,
        'quitURL': SITE + 'student.html?quit=1',   # the page goes here when the teacher closes the test
        'quitURLConfirm': False,
        'mobileEnableASAM': True,                  # use Apple's Assessment Mode (AAC) on personal iPads
        'mobileAllowSingleAppMode': False,
        'mobileShowSettings': False,
        'allowSpellCheck': False,
        'allowDictation': False,
        'enableZoomPage': True,
        'browserWindowAllowReload': True,
        'showReloadButton': True,
    }
    xml = plist(settings)
    data = gzip.compress(b'plnd' + gzip.compress(xml, mtime=0), mtime=0)
    dst = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), 'lock.seb')
    with open(dst, 'wb') as f: f.write(data)
    print('wrote', dst, len(data), 'bytes')

main()
