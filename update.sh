#!/bin/bash

HAS_NODEJS=`git remote | grep nodejs | wc -l`
HAS_IOJS=`git remote | grep iojs | wc -l`

if [[ $HAS_NODEJS -eq 0 ]] ; then
    git remote add nodejs 'git@github.com:joyent/node.git'
fi

if [[ $HAS_IOJS -eq 0 ]] ; then
    git remote add iojs 'git@github.com:nodejs/io.js.git'
fi

git fetch --tags nodejs
git fetch --tags iojs

cp index.html.top index.html

for tag in `git tag | grep -E '^v0\.[0-9]+\.[0-9]+$'`
{
    v8hash=`git log --pretty=format:%h refs/tags/$tag -- deps/v8 | head -n 1`
    if [[ ! -L $tag ]] ; then
	ln -s $v8hash $tag
	git add $tag
    fi
}

for tag in `git tag | grep -E '^v[1-9]+\.[0-9]+\.[0-9]+$'`
{
    v8hash=`git log --pretty=format:%h refs/tags/$tag -- deps/v8 | head -n 1`
    if [[ ! -L $tag ]] ; then
	ln -s $v8hash $tag
	git add $tag
    fi
}

last_hash=''
first_version=''
last_version=''

function generate() {
    # generate the dox
    sha1=$1
    if [[ ! -d $sha1 ]] ; then
	NAME="io.js"
	if [[ ${first_version##0} != $first_version ]] ; then
	    NAME="node.js"
	fi
	VERSION="v${first_version}"
	if [[ ${first_version} != ${last_version} ]] ; then
	    VERSION="v${first_version} - v${last_version}"
	fi
	echo "PROJECT_NAME = \"V8 API Reference Guide for ${NAME} ${VERSION}\"" > dox
	echo "OUTPUT_DIRECTORY = ./${sha1}" >> dox
	echo "INPUT = deps/v8/include" >> dox
	echo "GENERATE_LATEX = NO" >> dox
	rm -rf deps
	git checkout $sha1 -- deps/v8
	doxygen dox
	git add $sha1
	git reset -- deps
	rm -rf dox deps
    fi
}

for version in `ls -1d v* | sed -e 's/^v//' | sort -nr -t . -k1,1 -k2,2 -k3,3`
{
    hash=`readlink v${version}`
    if [[ $last_hash = '' ]] ; then
	last_hash=$hash
	first_version=$version
    fi

    if [[ $last_hash != $hash ]] ; then
	generate $hash
	last_hash=$hash
	first_version=$version
	last_version=$version
    else
	last_version=$version
    fi
    NAME="io.js"
    if [[ ${first_version##0} != $first_version ]] ; then
	NAME="node.js"
    fi
    echo "    <option value=\"v${version}\">${NAME} v${version}</option>" >> index.html
}
generate $last_hash


cat index.html.bottom >> index.html
git add index.html
