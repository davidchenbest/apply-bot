import puppeteer from 'puppeteer';
import fs from 'fs/promises'

import QUESTION_TYPES from './QUESTION_TYPES.mjs'
import prisma from './prisma/prismaClient.mjs';

const TASKS = 1

let ARR = []
main()
async function main() {
    const browser = await puppeteer.launch({
        headless: false, defaultViewport: {
            width: 1700,
            height: 1080
        }
    });
    const page = await browser.newPage();
    const cookies = JSON.parse(await fs.readFile('COOKIE'))
    await page.setCookie(...cookies)
    await page.exposeFunction("setCookie", setCookie);
    await page.exposeFunction("getJobURLs", () => getJobURLs(page));
    await page.exposeFunction("runTasks", () => runTasks(browser));
    await page.evaluate(createUserControls)

    page.on("framenavigated", async (frame) => {
        const url = frame.url();
        if (!/secure.indeed.com\/auth/i.test(url)) {
            await wait(1000)
            await page.evaluate(createUserControls)
        }
    });

    async function setCookie() {
        const cookies = await page.cookies();
        fs.writeFile('COOKIE', JSON.stringify(cookies), (err) => {
            if (err) console.error('err writing cookies')
            else console.log('cookies wrote to file')
        })
        // page.off('framenavigated')
    }
}

async function initPage(page) {
    page.on("dialog", dialog => dialog.accept());
    await page.exposeFunction("addArr", (item) => { ARR.push(item) });
    await page.exposeFunction("getQuestionTypes", () => QUESTION_TYPES);
}

async function runTasks(browser) {
    const jobs = (await prisma.job.findMany({ where: { applied: { equals: null } }, take: TASKS }))
    for (const job of jobs) {
        const page = await browser.newPage();
        await runPuppet(page, job)
    }
}

async function runPuppet(page, job) {
    await initPage(page)
    const URL = `https://www.indeed.com/viewjob?jk=${job.id}`

    try {
        await page.goto(URL, { waitUntil: 'load' });
        const jobTitle = job.title
        const company = job.company
        const isApplyCompanySite = await page.evaluate(() => /Apply on company site/i.test(document.querySelector('#applyButtonLinkContainer')?.innerHTML))

        if (isApplyCompanySite) {
            throw new Error('apply company site')
        }
        //check apply button is disabled
        const isApplyDisabled = await page.evaluate(() => document.querySelector('#indeedApplyButton')?.hasAttribute('disabled'))
        if (isApplyDisabled) {
            await fs.appendFile('ERROR_URLS', '\n' + JSON.stringify({ msg: 'applied', url: URL }) + ',')
            return
        }
        await page.click('#indeedApplyButton')
        await page.waitForNavigation()

        const needToLogin = await page.evaluate(() => !!document.querySelector('input[type=email]'))
        if (!needToLogin) await fillForms()
        else {
            return
        }

        async function fillForms() {
            let intervalId
            let preUrl
            await new Promise((resolve, reject) => {
                intervalId = setInterval(async () => {
                    try {
                        ARR = []
                        const currentUrl = await page.evaluate(() => document.location.href);
                        if (currentUrl == preUrl) {
                            throw new Error('fail submitting')
                        }
                        else preUrl = currentUrl
                        await page.evaluate(autoFillForms)
                        console.log(ARR);
                        for (const { id, classname, checked, value, selectValue } of ARR) {
                            if (id) {
                                if (selectValue) await page.select('#' + id, selectValue)
                                if (checked) await page.click('#' + id)
                                if (value) await page.type('#' + id, value)
                            }

                        }
                        const isSubmitAppBtn = await page.evaluate(() => /Submit your application/i.test(document.querySelector('.ia-continueButton')?.innerHTML))
                        if (isSubmitAppBtn) {
                            await page.screenshot({ path: './screenshots/' + [jobTitle, company].join('-') + '.png', type: 'png', fullPage: true });
                            await fs.appendFile('SUCCESS_URLS', '\n' + JSON.stringify({ url: URL }) + ',')
                            clearInterval(intervalId)
                            const { id } = job
                            await prisma.job.update({ data: { applied: true }, where: { id } })
                            resolve()
                        }
                        else await page.click('.ia-continueButton')

                    } catch (error) {
                        clearInterval(intervalId)
                        console.log('EXIT INTERVAL', error.message);
                        reject(error)
                    }

                }, 3000)
            })
        }
    }
    catch (error) {
        console.log(error);
        const { id } = job
        await prisma.job.update({ data: { errorMsg: error.message, applied: false }, where: { id } })

    }
}

async function autoFillForms() {
    const QUESTION_TYPES = await getQuestionTypes()
    const elements = document.querySelectorAll('.ia-Questions-item')
    for (const el of elements) {
        let useDefault = true
        if (/optional/i.test(el.innerHTML)) continue
        for (const { regex, checked, value, select } of QUESTION_TYPES) {
            if (!new RegExp(regex, 'i').test(el.innerHTML)) continue
            const textarea = el.querySelector('textarea')
            if (select) {
                const selectEl = el.querySelector('select')
                const options = el.querySelectorAll('option')
                for (const option of options) {
                    if (select.test(option.innerHTML)) {
                        const obj = {}
                        const id = selectEl.id
                        const classes = selectEl.classList
                        if (id) obj.id = id
                        else if (classes?.length) selectEl.classname = classes[0]
                        obj.selectValue = option.value
                        addArr(obj)
                        useDefault = false
                        break
                    }
                }
            }
            else if (textarea) {
                const obj = {}
                const input = textarea
                const id = input.id
                const classes = input.classList
                if (id) obj.id = id
                else if (classes.length) input.classname = classes[0]
                obj.value = value
                addArr(obj)
                useDefault = false
            }
            else {
                const inputs = el.querySelectorAll('input')
                if (!inputs.length) continue
                if (inputs[0].type === 'radio') {
                    // select yes
                    for (const input of inputs) {
                        if (checked && /1|Yes|true/i.test(input.value)) {
                            input.click()
                            useDefault = false
                            break
                        }
                        else if (!checked && /0|no|false/i.test(input.value)) {
                            input.click()
                            useDefault = false
                            break
                        }
                    }
                }
                else if (!inputs[0].value && ['text', 'number'].includes(inputs[0].type)) {
                    const obj = {}
                    const input = inputs[0]
                    const id = input.id
                    const classes = input.classList
                    if (id) obj.id = id
                    else if (classes.length) input.classname = classes[0]
                    obj.value = value
                    addArr(obj)
                    useDefault = false
                    // inputs[0].value = value
                    break
                }

            }

        }

        if (useDefault) {
            const inputs = el.querySelectorAll('input')
            if (!inputs.length) continue
            if (inputs[0].type === 'radio') {
                let hasInitialValue
                for (const input of inputs) {
                    if (input.checked) {
                        hasInitialValue = true
                        break
                    }
                }
                if (!hasInitialValue) {
                    // select no
                    for (const input of inputs) {
                        if (input.value == '0') {
                            input.click()
                        }
                    }
                }
            }
            else if (inputs[0].type == 'text' && !inputs[0].value) {
                const obj = {}
                const input = inputs[0]
                const id = input.id
                const classes = input.classList
                if (id) obj.id = id
                else if (classes.length) input.classname = classes[0]
                obj.value = 'N/A'
                addArr(obj)
            }
        }
    }
}

async function getJobURLs(page) {
    const jobs = await page.evaluate(() => [...document.querySelectorAll('tr h2 a')].map(el => (
        {
            id: el.getAttribute('data-jk'),
            title: el.innerHTML.replace(/<.+?>/g, ''),
            company: el.parentNode.parentNode.parentNode.querySelector('.companyName').innerHTML.replace(/<.+?>/g, ''),
        }
    )))
    const saveJobs = jobs.map(job => prisma.job.create({ data: job }))
    let r = await Promise.allSettled(saveJobs)
}

function createUserControls() {
    if (document.querySelector('#div_id')) return true
    let div = document.createElement("div");
    div.id = "div_id";
    div.className = "div_class";
    div.style = "background-color: lightgrey; position:absolute; top:1rem";
    createSetCookieButton()
    createPerformAutomateButton()
    createGetJobURLsButton()
    document?.body?.appendChild(div);
    function createSetCookieButton() {
        let btn = document.createElement("button");
        btn.innerText = 'Click after logged in'
        div.appendChild(btn);
        btn.addEventListener('click', setCookie)
    }
    function createPerformAutomateButton() {
        let btn = document.createElement("button");
        btn.innerText = 'automate'
        div.appendChild(btn);
        btn.addEventListener('click', runTasks)
    }
    function createGetJobURLsButton() {
        let btn = document.createElement("button");
        btn.innerText = 'getJobURLs'
        div.appendChild(btn);
        btn.addEventListener('click', getJobURLs)
    }
}

async function wait(time) {
    return new Promise((resolve, reject) => {
        setTimeout(() => {
            resolve()
        }, time)
    })
}